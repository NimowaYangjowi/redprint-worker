/**
 * Backup Verification – Dedicated Verify DB Flow
 *
 * Proves a backup is restorable by:
 *   1. reading the embedded backup manifest from the uploaded artifact,
 *   2. validating it against the prepared verify DB schema,
 *   3. resetting the dedicated verify DB to empty,
 *   4. restoring the uploaded backup into that isolated database via `psql`,
 *   5. checking restored data against the manifest.
 */

import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import postgres from 'postgres';

import { getR2ObjectStream } from '../storage/r2-client';
import {
  buildSchemaFingerprint,
  computeRowChecksum,
  parseBackupManifestFromSqlText,
  type BackupManifest,
} from './pg-dump';
import { getBackupVerifyDatabaseUrl, PSQL_RESTORE_TIMEOUT_MS } from './constants';

const BACKUP_MANIFEST_PREFIX = '-- backup_manifest: ';
const MAX_HEADER_BUFFER_LENGTH = 128 * 1024;

export interface VerifyResult {
  passed: boolean;
  verifyDbName: string;
  usedReplicaFallback?: boolean;
  error?: string;
  durationMs: number;
}

interface TableColumnInfo {
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: string;
}

interface TableVerifyInfo {
  tableName: string;
  columns: TableColumnInfo[];
  primaryKeyColumns: string[];
}

interface SequenceVerifyInfo {
  sequenceName: string;
  tableName: string;
  columnName: string;
}

/** Mask connection strings in error messages to prevent credential leaks. */
function maskConnectionString(message: string): string {
  const verifyUrl = process.env.BACKUP_VERIFY_DATABASE_URL;
  const adminUrl = process.env.BACKUP_ADMIN_DATABASE_URL;
  const dbUrl = process.env.DATABASE_URL;

  let masked = message;
  if (verifyUrl) masked = masked.replaceAll(verifyUrl, '***VERIFY_DB_URL***');
  if (adminUrl) masked = masked.replaceAll(adminUrl, '***ADMIN_DB_URL***');
  if (dbUrl) masked = masked.replaceAll(dbUrl, '***DATABASE_URL***');
  return masked;
}

function parseDatabaseName(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.split('/').filter(Boolean).pop();
  if (!name) {
    throw new Error('Could not extract database name from a Postgres URL');
  }
  return name;
}

function isSameDatabaseTarget(leftUrl: string, rightUrl: string): boolean {
  const left = new URL(leftUrl);
  const right = new URL(rightUrl);

  return (
    left.protocol === right.protocol &&
    left.hostname === right.hostname &&
    (left.port || defaultPostgresPort(left.protocol)) === (right.port || defaultPostgresPort(right.protocol)) &&
    decodeURIComponent(left.pathname) === decodeURIComponent(right.pathname)
  );
}

function defaultPostgresPort(protocol: string): string {
  return protocol === 'postgres:' || protocol === 'postgresql:' ? '5432' : '';
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toRegclassLiteral(schemaName: string, relationName: string): string {
  return quoteLiteral(`${quoteIdent(schemaName)}.${quoteIdent(relationName)}`);
}

async function readBackupManifestFromR2(r2Key: string): Promise<BackupManifest> {
  const r2Stream = await getR2ObjectStream(r2Key);
  const gunzip = createGunzip();

  return new Promise<BackupManifest>((resolve, reject) => {
    let settled = false;
    let buffer = '';

    const finish = (handler: (value: any) => void, value: any) => {
      if (settled) return;
      settled = true;

      gunzip.removeAllListeners();
      r2Stream.removeAllListeners?.();

      try {
        gunzip.destroy();
      } catch {
        // best effort
      }

      if (typeof r2Stream.destroy === 'function') {
        try {
          r2Stream.destroy();
        } catch {
          // best effort
        }
      }

      handler(value);
    };

    const handleError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      finish(reject, new Error(`Failed to read backup manifest from R2: ${message}`));
    };

    gunzip.setEncoding('utf8');

    gunzip.on('data', (chunk: string) => {
      buffer += chunk;

      if (buffer.length > MAX_HEADER_BUFFER_LENGTH) {
        handleError(new Error('Backup manifest header is missing or too large'));
        return;
      }

      const startIndex = buffer.indexOf(BACKUP_MANIFEST_PREFIX);
      if (startIndex === -1) {
        return;
      }

      const endIndex = buffer.indexOf('\n', startIndex);
      if (endIndex === -1) {
        return;
      }

      try {
        const manifest = parseBackupManifestFromSqlText(buffer.slice(startIndex, endIndex));
        finish(resolve, manifest);
      } catch (error) {
        handleError(error);
      }
    });

    gunzip.on('error', handleError);
    gunzip.on('end', () => {
      if (settled) return;

      try {
        const manifest = parseBackupManifestFromSqlText(buffer);
        finish(resolve, manifest);
      } catch (error) {
        handleError(error);
      }
    });

    r2Stream.on('error', handleError);
    r2Stream.pipe(gunzip);
  });
}

async function getVerifyTableInfos(sql: postgres.Sql): Promise<TableVerifyInfo[]> {
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const columnRows = await sql`
    SELECT
      table_name,
      column_name,
      data_type,
      udt_name,
      is_nullable,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;

  const primaryKeyRows = await sql`
    SELECT
      kcu.table_name,
      kcu.column_name,
      kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.table_name, kcu.ordinal_position
  `;

  const columnsByTable = new Map<string, TableColumnInfo[]>();
  for (const row of columnRows) {
    const columns = columnsByTable.get(row.table_name) ?? [];
    columns.push({
      columnName: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable,
    });
    columnsByTable.set(row.table_name, columns);
  }

  const primaryKeysByTable = new Map<string, string[]>();
  for (const row of primaryKeyRows) {
    const primaryKeyColumns = primaryKeysByTable.get(row.table_name) ?? [];
    primaryKeyColumns.push(row.column_name);
    primaryKeysByTable.set(row.table_name, primaryKeyColumns);
  }

  return tables.map((table) => ({
    tableName: table.table_name,
    columns: columnsByTable.get(table.table_name) ?? [],
    primaryKeyColumns: primaryKeysByTable.get(table.table_name) ?? [],
  }));
}

function assertManifestMatchesPreparedSchema(
  manifest: BackupManifest,
  tableInfos: TableVerifyInfo[],
): void {
  if (manifest.format_version !== 'v2') {
    throw new Error(`Unsupported backup format_version: ${manifest.format_version}`);
  }

  if (manifest.public_table_count !== tableInfos.length) {
    throw new Error(
      `Verify DB schema mismatch: expected ${manifest.public_table_count} public tables, found ${tableInfos.length}`,
    );
  }

  const actualFingerprint = buildSchemaFingerprint(tableInfos);
  if (manifest.schema_fingerprint !== actualFingerprint) {
    throw new Error('Verify DB schema fingerprint does not match the backup artifact');
  }

  const tableNames = new Set(tableInfos.map((tableInfo) => tableInfo.tableName));
  for (const sentinelTable of manifest.sentinel_tables) {
    if (!tableNames.has(sentinelTable)) {
      throw new Error(`Verify DB is missing sentinel table "${sentinelTable}" required by the backup manifest`);
    }
  }
}

async function resetVerifyDb(sql: postgres.Sql, tableInfos: TableVerifyInfo[]): Promise<void> {
  if (tableInfos.length === 0) {
    throw new Error(
      'Verify DB is missing public tables. Run the verify DB bootstrap before enabling daily verification.',
    );
  }

  const tableList = tableInfos.map((tableInfo) => quoteIdent(tableInfo.tableName)).join(', ');
  await sql.unsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

async function assertZeroRows(sql: postgres.Sql, tableInfos: TableVerifyInfo[]): Promise<void> {
  for (const tableInfo of tableInfos) {
    const [row] = await sql.unsafe(
      `SELECT EXISTS (SELECT 1 FROM ${quoteIdent(tableInfo.tableName)} LIMIT 1) AS has_rows`,
    );

    if (row?.has_rows) {
      throw new Error(
        `Verify DB reset failed: table "${tableInfo.tableName}" still has rows before restore`,
      );
    }
  }
}

async function getFirstRowJson(
  sql: postgres.Sql,
  tableInfo: TableVerifyInfo,
): Promise<string | null> {
  if (tableInfo.primaryKeyColumns.length === 0) {
    return null;
  }

  const orderBy = tableInfo.primaryKeyColumns.map(quoteIdent).join(', ');
  const rows = await sql.unsafe(
    `SELECT row_to_json(t)::text AS row_json FROM (` +
    `SELECT * FROM ${quoteIdent(tableInfo.tableName)} ORDER BY ${orderBy} LIMIT 1` +
    `) t`,
  );

  return rows[0]?.row_json ?? null;
}

async function assertSentinelChecksums(
  sql: postgres.Sql,
  tableInfos: TableVerifyInfo[],
  manifest: BackupManifest,
): Promise<void> {
  for (const sentinelTable of manifest.sentinel_tables) {
    const tableInfo = tableInfos.find((candidate) => candidate.tableName === sentinelTable);
    if (!tableInfo) {
      throw new Error(`Sentinel table "${sentinelTable}" is missing after restore`);
    }

    const expectedChecksum = manifest.sentinel_row_checksums[sentinelTable];
    if (!expectedChecksum) {
      throw new Error(`Backup manifest is missing the checksum for sentinel table "${sentinelTable}"`);
    }

    const rowJson = await getFirstRowJson(sql, tableInfo);
    if (!rowJson) {
      throw new Error(`Sentinel table "${sentinelTable}" has no rows after restore`);
    }

    const actualChecksum = computeRowChecksum(rowJson);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Sentinel checksum mismatch for "${sentinelTable}" after restore`);
    }
  }
}

async function getOwnedSequences(sql: postgres.Sql): Promise<SequenceVerifyInfo[]> {
  const sequenceRows = await sql`
    SELECT
      seq.relname AS sequence_name,
      tbl.relname AS table_name,
      attr.attname AS column_name
    FROM pg_class seq
    JOIN pg_namespace seq_ns ON seq.relnamespace = seq_ns.oid
    JOIN pg_depend dep ON dep.objid = seq.oid
    JOIN pg_class tbl ON dep.refobjid = tbl.oid
    JOIN pg_namespace tbl_ns ON tbl.relnamespace = tbl_ns.oid
    JOIN pg_attribute attr
      ON attr.attrelid = tbl.oid
     AND attr.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
      AND seq_ns.nspname = 'public'
      AND tbl_ns.nspname = 'public'
      AND dep.deptype IN ('a', 'i')
    ORDER BY seq.relname
  `;

  return sequenceRows.map((row) => ({
    sequenceName: row.sequence_name,
    tableName: row.table_name,
    columnName: row.column_name,
  }));
}

async function assertSequenceSmoke(sql: postgres.Sql): Promise<void> {
  const sequences = await getOwnedSequences(sql);

  for (const sequence of sequences) {
    const regclassLiteral = toRegclassLiteral('public', sequence.sequenceName);
    const [state] = await sql.unsafe(
      `SELECT last_value, is_called FROM ${quoteIdent(sequence.sequenceName)}`,
    );

    if (!state) {
      throw new Error(
        `Sequence smoke test failed for "${sequence.sequenceName}": original state is missing`,
      );
    }

    try {
      const [nextValueRow] = await sql.unsafe(
        `SELECT nextval(${regclassLiteral}::regclass) AS next_value`,
      );

      if (!nextValueRow || nextValueRow.next_value === null || nextValueRow.next_value === undefined) {
        throw new Error('nextval returned no value');
      }
    } catch (error) {
      throw new Error(
        `Sequence smoke test failed for "${sequence.sequenceName}" owned by ` +
        `"${sequence.tableName}"."${sequence.columnName}": ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await sql.unsafe(
        `SELECT setval(${regclassLiteral}::regclass, ${String(state.last_value)}, ${state.is_called ? 'true' : 'false'})`,
      );
    }
  }
}

async function verifyRestoredDb(
  sql: postgres.Sql,
  tableInfos: TableVerifyInfo[],
  manifest: BackupManifest,
): Promise<void> {
  let hasRestoredData = false;

  for (const tableInfo of tableInfos) {
    const [row] = await sql.unsafe(
      `SELECT EXISTS (SELECT 1 FROM ${quoteIdent(tableInfo.tableName)} LIMIT 1) AS has_rows`,
    );

    if (row?.has_rows) {
      hasRestoredData = true;
      break;
    }
  }

  if (!hasRestoredData) {
    throw new Error(
      'Verification failed: restored verify DB is empty after replaying the remote backup',
    );
  }

  await assertSentinelChecksums(sql, tableInfos, manifest);
  await assertSequenceSmoke(sql);
}

async function cleanupVerifyDbAfterVerification(
  sql: postgres.Sql,
  tableInfos: TableVerifyInfo[],
): Promise<void> {
  // Keep the dedicated verify DB empty between runs so restored user data
  // does not occupy disk longer than needed after verification finishes.
  await resetVerifyDb(sql, tableInfos);
  await assertZeroRows(sql, tableInfos);
}

async function* createRestoreSqlStream(
  r2Key: string,
  useReplicaFallback: boolean,
): AsyncGenerator<string | Buffer> {
  if (useReplicaFallback) {
    yield 'SET session_replication_role = replica;\n';
  }

  const r2Stream = await getR2ObjectStream(r2Key);
  const gunzip = createGunzip();
  const restoreStream = r2Stream.pipe(gunzip);

  for await (const chunk of restoreStream) {
    yield chunk;
  }

  if (useReplicaFallback) {
    yield '\nSET session_replication_role = DEFAULT;\n';
  }
}

async function restoreFromR2(
  r2Key: string,
  verifyUrl: string,
  options: { useReplicaFallback?: boolean } = {},
): Promise<void> {
  const restoreSqlStream = Readable.from(
    createRestoreSqlStream(r2Key, options.useReplicaFallback === true),
  );
  const psql = spawn(
    'psql',
    ['-d', verifyUrl, '-v', 'ON_ERROR_STOP=1'],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: PSQL_RESTORE_TIMEOUT_MS,
    },
  );

  const stderrChunks: Buffer[] = [];
  psql.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const exitPromise = new Promise<void>((resolve, reject) => {
    psql.on('error', (err) =>
      reject(new Error(`psql process error: ${err.message}`)),
    );
    psql.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString().trim();
      reject(
        new Error(`psql exited with code ${code}${stderr ? `: ${stderr}` : ''}`),
      );
    });
  });

  const [pipelineResult, exitResult] = await Promise.allSettled([
    pipeline(restoreSqlStream, psql.stdin as NodeJS.WritableStream),
    exitPromise,
  ]);

  if (exitResult.status === 'rejected') {
    throw exitResult.reason;
  }

  if (pipelineResult.status === 'rejected') {
    throw pipelineResult.reason;
  }
}

function isForeignKeyRestoreFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('violates foreign key constraint') ||
    message.includes('violates foreign key')
  );
}

async function restoreWithFallbackIfNeeded(
  sql: postgres.Sql,
  tableInfos: TableVerifyInfo[],
  r2Key: string,
  verifyUrl: string,
): Promise<boolean> {
  try {
    await restoreFromR2(r2Key, verifyUrl);
    return false;
  } catch (error) {
    if (!isForeignKeyRestoreFailure(error)) {
      throw error;
    }

    await resetVerifyDb(sql, tableInfos);
    await assertZeroRows(sql, tableInfos);
    await restoreFromR2(r2Key, verifyUrl, { useReplicaFallback: true });
    return true;
  }
}

export async function verifyBackupFromR2(r2Key: string): Promise<VerifyResult> {
  const start = Date.now();

  const verifyUrl = getBackupVerifyDatabaseUrl();
  if (!verifyUrl) {
    throw new Error(
      'BACKUP_VERIFY_DATABASE_URL is not set – cannot perform daily restore verification.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  if (isSameDatabaseTarget(verifyUrl, databaseUrl)) {
    throw new Error(
      'BACKUP_VERIFY_DATABASE_URL must point to a dedicated verify DB, not the live app DATABASE_URL.',
    );
  }

  const verifyDbName = parseDatabaseName(verifyUrl);
  const verifySql = postgres(verifyUrl, {
    connect_timeout: 30,
    idle_timeout: 0,
    max: 1,
  });

  let tableInfos: TableVerifyInfo[] = [];
  let cleanupEligible = false;
  try {
    let usedReplicaFallback = false;
    const manifest = await readBackupManifestFromR2(r2Key);
    tableInfos = await getVerifyTableInfos(verifySql);
    cleanupEligible = tableInfos.length > 0;
    assertManifestMatchesPreparedSchema(manifest, tableInfos);
    await resetVerifyDb(verifySql, tableInfos);
    await assertZeroRows(verifySql, tableInfos);
    usedReplicaFallback = await restoreWithFallbackIfNeeded(
      verifySql,
      tableInfos,
      r2Key,
      verifyUrl,
    );
    await verifyRestoredDb(verifySql, tableInfos, manifest);
    await cleanupVerifyDbAfterVerification(verifySql, tableInfos);

    return {
      passed: true,
      verifyDbName,
      usedReplicaFallback,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);

    if (cleanupEligible) {
      try {
        await cleanupVerifyDbAfterVerification(verifySql, tableInfos);
      } catch (cleanupErr) {
        const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        message = `${message}; verify DB cleanup also failed: ${cleanupMessage}`;
      }
    }

    return {
      passed: false,
      verifyDbName,
      error: maskConnectionString(message),
      durationMs: Date.now() - start,
    };
  } finally {
    await verifySql.end();
  }
}
