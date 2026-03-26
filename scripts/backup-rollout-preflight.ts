import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.worker' });
config({ path: '.env.local' });

const MAIN_MODULE_PATH = process.argv[1];
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'BACKUP_VERIFY_DATABASE_URL',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
] as const;
const REQUIRED_BACKUP_LOG_COLUMNS = [
  'format_version',
  'verification_status',
  'verified_at',
  'verified_from_r2_key',
] as const;

export interface PreflightChecklistItem {
  label: string;
  ok: boolean;
  detail: string;
}

function defaultPostgresPort(protocol: string): string {
  return protocol === 'postgres:' || protocol === 'postgresql:' ? '5432' : '';
}

export function isSameDatabaseTarget(leftUrl: string, rightUrl: string): boolean {
  const left = new URL(leftUrl);
  const right = new URL(rightUrl);

  return (
    left.protocol === right.protocol &&
    left.hostname === right.hostname &&
    (left.port || defaultPostgresPort(left.protocol)) === (right.port || defaultPostgresPort(right.protocol)) &&
    decodeURIComponent(left.pathname) === decodeURIComponent(right.pathname)
  );
}

export function getMissingRequiredEnv(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
}

export function hasCommand(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function formatChecklistLine(item: PreflightChecklistItem): string {
  return `${item.ok ? '[ok]' : '[x]'} ${item.label}: ${item.detail}`;
}

async function inspectBackupLogs(databaseUrl: string): Promise<{
  tableExists: boolean;
  actualColumns: string[];
}> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 0 });

  try {
    const [tableExists] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'backup_logs'
      ) AS exists
    `;

    if (!tableExists?.exists) {
      return {
        tableExists: false,
        actualColumns: [],
      };
    }

    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'backup_logs'
        AND column_name = ANY(${REQUIRED_BACKUP_LOG_COLUMNS})
      ORDER BY column_name
    `;

    return {
      tableExists: true,
      actualColumns: columns.map((row) => row.column_name),
    };
  } finally {
    await sql.end();
  }
}

async function inspectVerifyDb(verifyUrl: string): Promise<{
  verifyDbName: string;
  publicTableCount: number;
}> {
  const sql = postgres(verifyUrl, { max: 1, connect_timeout: 10, idle_timeout: 0 });

  try {
    const [databaseRow] = await sql<{ current_database: string }[]>`
      SELECT current_database()
    `;
    const [countRow] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;

    return {
      verifyDbName: databaseRow?.current_database ?? '(unknown)',
      publicTableCount: countRow?.total ?? 0,
    };
  } finally {
    await sql.end();
  }
}

export async function runBackupRolloutPreflight(): Promise<PreflightChecklistItem[]> {
  const items: PreflightChecklistItem[] = [];
  const missingEnv = getMissingRequiredEnv(process.env);

  if (missingEnv.length > 0) {
    items.push({
      label: 'required env',
      ok: false,
      detail: `missing ${missingEnv.join(', ')}`,
    });
    return items;
  }

  const databaseUrl = process.env.DATABASE_URL!;
  const verifyUrl = process.env.BACKUP_VERIFY_DATABASE_URL!;

  items.push({
    label: 'required env',
    ok: true,
    detail: 'DATABASE_URL, verify DB, and R2 credentials are present',
  });

  items.push({
    label: 'verify DB safety',
    ok: !isSameDatabaseTarget(databaseUrl, verifyUrl),
    detail: isSameDatabaseTarget(databaseUrl, verifyUrl)
      ? 'BACKUP_VERIFY_DATABASE_URL points at the live app DB'
      : 'verify DB is isolated from the live app DB',
  });

  items.push({
    label: 'psql runtime',
    ok: hasCommand('psql'),
    detail: hasCommand('psql')
      ? '`psql` is available in PATH'
      : '`psql` is missing in PATH',
  });

  try {
    const backupLogs = await inspectBackupLogs(databaseUrl);
    if (!backupLogs.tableExists) {
      items.push({
        label: 'backup_logs table',
        ok: false,
        detail: 'backup_logs table does not exist yet',
      });
    } else {
      const missingColumns = REQUIRED_BACKUP_LOG_COLUMNS.filter(
        (column) => !backupLogs.actualColumns.includes(column),
      );
      items.push({
        label: 'backup_logs phase-3 columns',
        ok: missingColumns.length === 0,
        detail: missingColumns.length === 0
          ? 'phase-3 verification columns are present'
          : `missing ${missingColumns.join(', ')}`,
      });
    }
  } catch (error) {
    items.push({
      label: 'backup_logs phase-3 columns',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const verifyDb = await inspectVerifyDb(verifyUrl);
    items.push({
      label: 'verify DB schema',
      ok: verifyDb.publicTableCount > 0,
      detail: verifyDb.publicTableCount > 0
        ? `${verifyDb.verifyDbName} has ${verifyDb.publicTableCount} public tables ready for restore verification`
        : `${verifyDb.verifyDbName} has no public tables; bootstrap it before rollout`,
    });
  } catch (error) {
    items.push({
      label: 'verify DB schema',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return items;
}

async function main(): Promise<void> {
  const items = await runBackupRolloutPreflight();

  for (const item of items) {
    process.stdout.write(`${formatChecklistLine(item)}\n`);
  }

  const failed = items.some((item) => !item.ok);
  if (failed) {
    process.stdout.write(
      '\nPreflight failed. Fix the items above before deploying the backup worker or menu bar backup card.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    '\nPreflight passed. This environment is ready for phase-4 rollout steps.\n',
  );
}

if (MAIN_MODULE_PATH === fileURLToPath(import.meta.url)) {
  await main();
}
