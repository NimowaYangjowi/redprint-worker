/**
 * Backup Logger
 * Persists backup execution events to the database for monitoring.
 */

import { eq } from 'drizzle-orm';
import { db, backupLogs } from '../../db';

/**
 * Log the start of a backup. Returns the log record ID.
 */
export async function logBackupStart(): Promise<string> {
  const [row] = await db.insert(backupLogs).values({
    status: 'running',
    startedAt: new Date(),
  }).returning({ id: backupLogs.id });

  return row.id;
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
  }
): Promise<void> {
  await db.update(backupLogs)
    .set({
      status: 'success',
      r2Key: data.r2Key,
      fileSize: data.fileSize,
      durationMs: data.durationMs,
      retentionKept: data.retentionKept ?? null,
      retentionDeleted: data.retentionDeleted ?? null,
      completedAt: new Date(),
    })
    .where(eq(backupLogs.id, id));
}

/**
 * Log a failed backup.
 */
export async function logBackupFailed(
  id: string,
  errorMessage: string,
  durationMs: number
): Promise<void> {
  await db.update(backupLogs)
    .set({
      status: 'failed',
      errorMessage,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(backupLogs.id, id));
}
