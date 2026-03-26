/**
 * Backup Logger
 * Persists backup execution events to the database for monitoring.
 */

import { eq } from 'drizzle-orm';
import { db, backupLogs } from '../../db';

const PHASE3_BACKUP_LOG_COLUMNS = [
  'format_version',
  'verification_status',
  'verified_at',
  'verified_from_r2_key',
] as const;

function isMissingPhase3BackupLogsColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const code = (error as Error & { code?: string }).code;
  const column = ((error as Error & { column?: string }).column ?? '').toLowerCase();

  if (code === '42703' && PHASE3_BACKUP_LOG_COLUMNS.includes(column as (typeof PHASE3_BACKUP_LOG_COLUMNS)[number])) {
    return true;
  }

  return PHASE3_BACKUP_LOG_COLUMNS.some((requiredColumn) =>
    message.includes(requiredColumn) && message.includes('does not exist'),
  );
}

function wrapBackupLogsSchemaError(error: unknown): Error {
  if (!isMissingPhase3BackupLogsColumnError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return new Error(
    'backup_logs is missing the phase-3 verification columns. ' +
    'Run scripts/migrate-backup-logs.sql before deploying the backup worker or monitoring app.',
  );
}

async function withBackupLogsSchemaGuard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw wrapBackupLogsSchemaError(error);
  }
}

/**
 * Log the start of a backup. Returns the log record ID.
 */
export async function logBackupStart(): Promise<string> {
  const [row] = await withBackupLogsSchemaGuard(() =>
    db.insert(backupLogs).values({
      status: 'running',
      startedAt: new Date(),
      formatVersion: 'v2',
      verificationStatus: 'pending',
    }).returning({ id: backupLogs.id }),
  );

  return row.id;
}

/**
 * Log that the backup file reached remote storage and verification is next.
 */
export async function logBackupUploadComplete(
  id: string,
  r2Key: string
): Promise<void> {
  await withBackupLogsSchemaGuard(() =>
    db.update(backupLogs)
      .set({
        status: 'running',
        r2Key,
        formatVersion: 'v2',
        verificationStatus: 'pending',
      })
      .where(eq(backupLogs.id, id)),
  );
}

/**
 * Log a successful backup completion.
 */
export async function logBackupSuccess(
  id: string,
  data: {
    r2Key: string;
    fileSize: number;
    durationMs: number;
    retentionKept?: number;
    retentionDeleted?: number;
    verifiedFromR2Key?: string;
  }
): Promise<void> {
  await withBackupLogsSchemaGuard(() =>
    db.update(backupLogs)
      .set({
        status: 'success',
        r2Key: data.r2Key,
        fileSize: data.fileSize,
        durationMs: data.durationMs,
        retentionKept: data.retentionKept ?? null,
        retentionDeleted: data.retentionDeleted ?? null,
        formatVersion: 'v2',
        verificationStatus: 'passed',
        verifiedAt: new Date(),
        verifiedFromR2Key: data.verifiedFromR2Key ?? null,
        completedAt: new Date(),
      })
      .where(eq(backupLogs.id, id)),
  );
}

/**
 * Log a failed backup.
 */
export async function logBackupFailed(
  id: string,
  errorMessage: string,
  durationMs: number,
  verificationFailed: boolean = false
): Promise<void> {
  await withBackupLogsSchemaGuard(() =>
    db.update(backupLogs)
      .set({
        status: 'failed',
        errorMessage,
        durationMs,
        formatVersion: 'v2',
        ...(verificationFailed ? { verificationStatus: 'failed' } : {}),
        completedAt: new Date(),
      })
      .where(eq(backupLogs.id, id)),
  );
}
