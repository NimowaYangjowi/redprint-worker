import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.worker' });
config({ path: '.env.local' });

const MAIN_MODULE_PATH = process.argv[1];
const REQUIRED_PHASE3_COLUMNS = [
  'format_version',
  'verification_status',
  'verified_at',
  'verified_from_r2_key',
] as const;

export interface BackupStatusEntry {
  status: string;
  r2_key: string | null;
  file_size: number | null;
  duration_ms: number | null;
  error_message: string | null;
  format_version: string | null;
  verification_status: string | null;
  verified_at: Date | null;
  verified_from_r2_key: string | null;
  started_at: Date;
  completed_at: Date | null;
}

export interface BackupRolloutSnapshot {
  latest: BackupStatusEntry | null;
  latestVerified: BackupStatusEntry | null;
  totalVerified: number;
  hasPhase3Columns: boolean;
}

export type BackupUiState =
  | 'none'
  | 'running'
  | 'verifying'
  | 'verified'
  | 'legacy'
  | 'failed'
  | 'failed-verification'
  | 'unknown';

export function getBackupUiState(entry: BackupStatusEntry | null): BackupUiState {
  if (!entry) {
    return 'none';
  }

  const hasRemoteObject = Boolean(entry.r2_key);
  const verificationStatus = entry.verification_status ?? null;

  if (entry.status === 'running') {
    return hasRemoteObject && verificationStatus === 'pending' ? 'verifying' : 'running';
  }

  if (entry.status === 'success') {
    return verificationStatus === 'passed' ? 'verified' : 'legacy';
  }

  if (entry.status === 'failed') {
    return verificationStatus === 'failed' ? 'failed-verification' : 'failed';
  }

  return 'unknown';
}

export function describeBackupUiState(state: BackupUiState): string {
  switch (state) {
    case 'none':
      return '백업 기록 없음';
    case 'running':
      return '실행 중';
    case 'verifying':
      return '검증 중';
    case 'verified':
      return '정상';
    case 'legacy':
      return '레거시';
    case 'failed':
      return '실패';
    case 'failed-verification':
      return '검증 실패';
    default:
      return '알 수 없음';
  }
}

async function backupLogsHasPhase3Columns(databaseUrl: string): Promise<boolean> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 0 });

  try {
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'backup_logs'
        AND column_name = ANY(${REQUIRED_PHASE3_COLUMNS})
    `;

    return columns.length === REQUIRED_PHASE3_COLUMNS.length;
  } finally {
    await sql.end();
  }
}

async function backupLogsTableExists(databaseUrl: string): Promise<boolean> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 0 });

  try {
    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'backup_logs'
      ) AS exists
    `;

    return row?.exists === true;
  } finally {
    await sql.end();
  }
}

export async function readBackupRolloutSnapshot(databaseUrl: string): Promise<BackupRolloutSnapshot> {
  const tableExists = await backupLogsTableExists(databaseUrl);
  if (!tableExists) {
    return {
      latest: null,
      latestVerified: null,
      totalVerified: 0,
      hasPhase3Columns: false,
    };
  }

  const hasPhase3Columns = await backupLogsHasPhase3Columns(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 0 });

  try {
    const latestQuery = hasPhase3Columns
      ? `
        SELECT status, r2_key, file_size, duration_ms, error_message,
               format_version, verification_status, verified_at, verified_from_r2_key,
               started_at, completed_at
        FROM backup_logs
        ORDER BY started_at DESC
        LIMIT 1
      `
      : `
        SELECT status, r2_key, file_size, duration_ms, error_message,
               NULL::text AS format_version,
               NULL::text AS verification_status,
               NULL::timestamptz AS verified_at,
               NULL::text AS verified_from_r2_key,
               started_at, completed_at
        FROM backup_logs
        ORDER BY started_at DESC
        LIMIT 1
      `;

    const historyLatest = await sql.unsafe<BackupStatusEntry[]>(latestQuery);
    const latest = historyLatest[0] ?? null;

    if (!hasPhase3Columns) {
      return {
        latest,
        latestVerified: null,
        totalVerified: 0,
        hasPhase3Columns,
      };
    }

    const latestVerified = (await sql.unsafe<BackupStatusEntry[]>(`
      SELECT status, r2_key, file_size, duration_ms, error_message,
             format_version, verification_status, verified_at, verified_from_r2_key,
             started_at, completed_at
      FROM backup_logs
      WHERE status = 'success' AND verification_status = 'passed'
      ORDER BY started_at DESC
      LIMIT 1
    `))[0] ?? null;

    const [countRow] = await sql.unsafe<{ total: number }[]>(`
      SELECT COUNT(*)::int AS total
      FROM backup_logs
      WHERE status = 'success' AND verification_status = 'passed'
    `);

    return {
      latest,
      latestVerified,
      totalVerified: countRow?.total ?? 0,
      hasPhase3Columns,
    };
  } finally {
    await sql.end();
  }
}

function formatDate(value: Date | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toISOString();
}

function formatBytes(value: number | null): string {
  if (!value) {
    return '—';
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set before reading rollout status.');
  }

  const snapshot = await readBackupRolloutSnapshot(databaseUrl);
  const latestState = getBackupUiState(snapshot.latest);

  process.stdout.write(`phase-3 columns: ${snapshot.hasPhase3Columns ? 'yes' : 'no'}\n`);
  process.stdout.write(`latest backup state: ${describeBackupUiState(latestState)}\n`);

  if (snapshot.latest) {
    process.stdout.write(`latest started_at: ${formatDate(snapshot.latest.started_at)}\n`);
    process.stdout.write(`latest r2_key: ${snapshot.latest.r2_key ?? '—'}\n`);
    process.stdout.write(`latest verification_status: ${snapshot.latest.verification_status ?? '—'}\n`);
    process.stdout.write(`latest size: ${formatBytes(snapshot.latest.file_size)}\n`);
    process.stdout.write(`latest error: ${snapshot.latest.error_message ?? '—'}\n`);
  }

  process.stdout.write(`latest verified_at: ${formatDate(snapshot.latestVerified?.verified_at ?? null)}\n`);
  process.stdout.write(`total restore-verified backups: ${snapshot.totalVerified}\n`);
}

if (MAIN_MODULE_PATH === fileURLToPath(import.meta.url)) {
  await main();
}
