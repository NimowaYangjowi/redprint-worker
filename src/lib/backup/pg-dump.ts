/**
 * pg_dump via Node.js – v2 COPY format
 * Uses the postgres.js driver to dump all tables as COPY FROM STDIN blocks,
 * preserves sequence state with SELECT setval() statements, and embeds a
 * restore manifest in the SQL header.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createWriteStream, statSync, unlinkSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';

import { PG_DUMP_TIMEOUT_MS, GZIP_VERIFY_TIMEOUT_MS } from './constants';

const BACKUP_MANIFEST_PREFIX = '-- backup_manifest: ';
const BACKUP_FORMAT_VERSION = 'v2';
const DUMP_CURSOR_BATCH_SIZE = 100;
const SENTINEL_TABLE_CANDIDATES = ['assets', 'notifications', 'users'] as const;
const PG_DATE_TYPE_OIDS = [1082, 1114, 1184] as const;

export interface BackupManifest {
  format_version: string;
  schema_fingerprint: string;
  public_table_count: number;
  sentinel_tables: string[];
  sentinel_row_checksums: Record<string, string>;
}

export const PG_DUMP_TYPES = {
  date: {
    to: 1184,
    from: [...PG_DATE_TYPE_OIDS],
    serialize: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
    parse: (value: string) => value,
  },
} as const;

interface TableColumnInfo {
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: string;
}

interface TableDumpInfo {
  tableName: string;
  columnNames: string[];
  columns: TableColumnInfo[];
  primaryKeyColumns: string[];
}

/** Mask DATABASE_URL in error messages to prevent credential leaks */
function maskConnectionString(message: string): string {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return message;
  return message.replaceAll(dbUrl, '***DATABASE_URL***');
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function qualifyPublicIdent(identifier: string): string {
  return `${quoteIdent('public')}.${quoteIdent(identifier)}`;
}

export function formatCopyTableStatement(tableName: string, columnNames: string[]): string {
  const colList = columnNames.map((column) => quoteIdent(column)).join(', ');
  return `COPY ${qualifyPublicIdent(tableName)} (${colList}) FROM STDIN;\n`;
}

export function formatSequenceSetvalStatement(
  sequenceName: string,
  lastValue: number | string,
  isCalled: boolean,
): string {
  return (
    `SELECT pg_catalog.setval(` +
    `'${quoteIdent('public')}.${quoteIdent(sequenceName)}'::regclass, ` +
    `${lastValue}, ${isCalled});\n\n`
  );
}

export function formatPostgresArrayLiteral(values: unknown[]): string {
  return `{${values.map(formatPostgresArrayElement).join(',')}}`;
}

function formatPostgresArrayElement(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value)) return formatPostgresArrayLiteral(value);
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 't' : 'f';

  const str = value instanceof Date
    ? value.toISOString()
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function checksumText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeRowChecksum(rowJson: string): string {
  return checksumText(rowJson);
}

export function buildSchemaFingerprint(
  tableInfos: Array<{
    tableName: string;
    columns: TableColumnInfo[];
    primaryKeyColumns: string[];
  }>,
): string {
  const normalized = [...tableInfos]
    .map((tableInfo) => ({
      tableName: tableInfo.tableName,
      columns: tableInfo.columns.map((column) => ({
        columnName: column.columnName,
        dataType: column.dataType,
        udtName: column.udtName,
        isNullable: column.isNullable,
      })),
      primaryKeyColumns: [...tableInfo.primaryKeyColumns],
    }))
    .sort((left, right) => left.tableName.localeCompare(right.tableName));

  return checksumText(JSON.stringify(normalized));
}

export function formatBackupManifestComment(manifest: BackupManifest): string {
  return `${BACKUP_MANIFEST_PREFIX}${JSON.stringify(manifest)}\n`;
}

export function parseBackupManifestFromSqlText(sqlText: string): BackupManifest {
  const manifestLine = sqlText
    .split('\n')
    .find((line) => line.startsWith(BACKUP_MANIFEST_PREFIX));

  if (!manifestLine) {
    throw new Error('Backup manifest header is missing');
  }

  const manifestJson = manifestLine.slice(BACKUP_MANIFEST_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch (error) {
    throw new Error(
      `Backup manifest header is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup manifest header must be a JSON object');
  }

  const manifest = parsed as Partial<BackupManifest>;
  if (
    typeof manifest.format_version !== 'string' ||
    typeof manifest.schema_fingerprint !== 'string' ||
    typeof manifest.public_table_count !== 'number' ||
    !Array.isArray(manifest.sentinel_tables) ||
    !manifest.sentinel_tables.every((value) => typeof value === 'string') ||
    !manifest.sentinel_row_checksums ||
    typeof manifest.sentinel_row_checksums !== 'object'
  ) {
    throw new Error('Backup manifest header is missing required metadata fields');
  }

  const sentinelRowChecksums = Object.fromEntries(
    Object.entries(manifest.sentinel_row_checksums).map(([tableName, checksum]) => {
      if (typeof checksum !== 'string') {
        throw new Error('Backup manifest sentinel_row_checksums must map table names to checksum strings');
      }
      return [tableName, checksum];
    }),
  );

  return {
    format_version: manifest.format_version,
    schema_fingerprint: manifest.schema_fingerprint,
    public_table_count: manifest.public_table_count,
    sentinel_tables: [...manifest.sentinel_tables],
    sentinel_row_checksums: sentinelRowChecksums,
  };
}

/**
 * Escape a value for COPY FROM STDIN format (TSV).
 * - NULL → \N
 * - Backslash → \\
 * - Tab → \t
 * - Newline → \n
 * - Carriage return → \r
 */
function escapeCopyValue(value: unknown, column: TableColumnInfo): string {
  if (value === null || value === undefined) return '\\N';
  if (column.dataType === 'ARRAY' && Array.isArray(value)) {
    return formatPostgresArrayLiteral(value);
  }
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();

  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);

  return str
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Execute a Node.js-based database dump and produce a gzipped SQL file.
 * @returns Path to the temporary .sql.gz file
 * @throws On dump failure, timeout, empty output, or gzip corruption
 */
export async function runPgDump(): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tempPath = join(tmpdir(), `redprint-db-${timestamp}.sql.gz`);

  try {
    await withTimeout(
      dumpAndCompress(databaseUrl, tempPath),
      PG_DUMP_TIMEOUT_MS,
      `Database dump timed out after ${PG_DUMP_TIMEOUT_MS}ms`,
    );

    const stat = statSync(tempPath);
    if (stat.size === 0) {
      throw new Error('Database dump produced an empty file');
    }

    await verifyGzipIntegrity(tempPath);

    return tempPath;
  } catch (err) {
    cleanupFile(tempPath);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`pg_dump failed: ${maskConnectionString(message)}`);
  }
}

async function dumpAndCompress(databaseUrl: string, outputPath: string): Promise<void> {
  const sql = postgres(databaseUrl, {
    connect_timeout: 30,
    idle_timeout: 0,
    max: 1,
    types: PG_DUMP_TYPES,
  });

  try {
    const tableInfos = await getPublicTableInfos(sql);
    const manifest = await buildBackupManifest(sql, tableInfos);
    const gzip = createGzip({ level: 6 });
    const outStream = createWriteStream(outputPath);
    const readable = Readable.from(generateDumpChunks(sql, tableInfos, manifest));

    await pipeline(readable, gzip, outStream);
  } finally {
    await sql.end();
  }
}

async function getPublicTableInfos(sql: postgres.Sql): Promise<TableDumpInfo[]> {
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
    const tableColumns = columnsByTable.get(row.table_name) ?? [];
    tableColumns.push({
      columnName: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable,
    });
    columnsByTable.set(row.table_name, tableColumns);
  }

  const primaryKeysByTable = new Map<string, string[]>();
  for (const row of primaryKeyRows) {
    const pkColumns = primaryKeysByTable.get(row.table_name) ?? [];
    pkColumns.push(row.column_name);
    primaryKeysByTable.set(row.table_name, pkColumns);
  }

  return tables.map((table) => {
    const columns = columnsByTable.get(table.table_name) ?? [];

    return {
      tableName: table.table_name,
      columnNames: columns.map((column) => column.columnName),
      columns,
      primaryKeyColumns: primaryKeysByTable.get(table.table_name) ?? [],
    };
  });
}

async function buildBackupManifest(
  sql: postgres.Sql,
  tableInfos: TableDumpInfo[],
): Promise<BackupManifest> {
  const sentinelRowChecksums: Record<string, string> = {};

  for (const tableName of SENTINEL_TABLE_CANDIDATES) {
    const tableInfo = tableInfos.find((candidate) => candidate.tableName === tableName);
    if (!tableInfo || tableInfo.primaryKeyColumns.length === 0) {
      continue;
    }

    const rowJson = await getFirstRowJson(sql, tableInfo);
    if (!rowJson) {
      continue;
    }

    sentinelRowChecksums[tableName] = computeRowChecksum(rowJson);
  }

  return {
    format_version: BACKUP_FORMAT_VERSION,
    schema_fingerprint: buildSchemaFingerprint(tableInfos),
    public_table_count: tableInfos.length,
    sentinel_tables: Object.keys(sentinelRowChecksums),
    sentinel_row_checksums: sentinelRowChecksums,
  };
}

async function getFirstRowJson(
  sql: postgres.Sql,
  tableInfo: TableDumpInfo,
): Promise<string | null> {
  if (tableInfo.primaryKeyColumns.length === 0) {
    return null;
  }

  const orderBy = tableInfo.primaryKeyColumns.map(quoteIdent).join(', ');
  const rows = await sql.unsafe(
    `SELECT row_to_json(t)::text AS row_json FROM (` +
    `SELECT * FROM ${qualifyPublicIdent(tableInfo.tableName)} ORDER BY ${orderBy} LIMIT 1` +
    `) t`,
  );

  return rows[0]?.row_json ?? null;
}

async function* generateDumpChunks(
  sql: postgres.Sql,
  tableInfos: TableDumpInfo[],
  manifest: BackupManifest,
): AsyncGenerator<string> {
  yield '-- Redprint Database Dump\n';
  yield `-- Format: ${BACKUP_FORMAT_VERSION}\n`;
  yield `-- Generated: ${new Date().toISOString()}\n`;
  yield '-- Method: Node.js postgres driver (COPY format)\n';
  yield formatBackupManifestComment(manifest);
  yield '\n';
  yield "SET statement_timeout = 0;\n";
  yield "SET lock_timeout = 0;\n";
  yield "SET client_encoding = 'UTF8';\n";
  yield 'SET standard_conforming_strings = on;\n\n';

  for (const tableInfo of tableInfos) {
    yield `-- Table: ${tableInfo.tableName}\n`;
    yield formatCopyTableStatement(tableInfo.tableName, tableInfo.columnNames);

    const rowQuery = sql.unsafe(`SELECT * FROM ${qualifyPublicIdent(tableInfo.tableName)}`);
    for await (const batch of rowQuery.cursor(DUMP_CURSOR_BATCH_SIZE)) {
      for (const row of batch as Record<string, unknown>[]) {
        const values = tableInfo.columns.map((column) => escapeCopyValue(row[column.columnName], column));
        yield `${values.join('\t')}\n`;
      }
    }

    yield '\\.\n\n';
  }

  const sequences = await sql`
    SELECT s.relname AS sequence_name
    FROM pg_class s
    JOIN pg_namespace n ON s.relnamespace = n.oid
    WHERE s.relkind = 'S' AND n.nspname = 'public'
    ORDER BY s.relname
  `;

  for (const { sequence_name } of sequences) {
    const [seqState] = await sql`
      SELECT last_value, is_called FROM ${sql(sequence_name)}
    `;

    if (!seqState) continue;

    yield `-- Sequence: ${sequence_name}\n`;
    yield formatSequenceSetvalStatement(sequence_name, seqState.last_value, seqState.is_called);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Verify gzip file integrity using gzip -t */
function verifyGzipIntegrity(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'gzip',
      ['-t', filePath],
      { timeout: GZIP_VERIFY_TIMEOUT_MS },
      (error) => {
        if (error) {
          reject(new Error(`gzip integrity check failed: ${error.message}`));
        } else {
          resolve();
        }
      },
    );
  });
}

/** Safely remove a file if it exists */
function cleanupFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup
  }
}
