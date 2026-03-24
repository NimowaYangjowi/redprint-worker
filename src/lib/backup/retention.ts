/**
 * Backup Retention Policy
 * Deletes backups older than the configured retention period.
 * Always keeps at least MIN_BACKUPS_TO_KEEP backups (safety net).
 */

import { listR2Files, deleteMultipleFromR2 } from '../storage/r2-client';
import { BACKUP_PREFIX, MIN_BACKUPS_TO_KEEP, getRetentionDays } from './constants';

export interface RetentionResult {
  totalBackups: number;
  deleted: number;
  kept: number;
}

/**
 * Apply retention policy: delete backups older than retention period.
 * Always keeps at least MIN_BACKUPS_TO_KEEP backups.
 */
export async function applyRetention(): Promise<RetentionResult> {
  const retentionDays = getRetentionDays();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  // List all backups
  const allBackups = await listR2Files(BACKUP_PREFIX);

  // Sort by lastModified descending (newest first)
  allBackups.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  if (allBackups.length <= MIN_BACKUPS_TO_KEEP) {
    return {
      totalBackups: allBackups.length,
      deleted: 0,
      kept: allBackups.length,
    };
  }

  // Find backups older than cutoff, iterating oldest-first.
  // Always keep at least MIN_BACKUPS_TO_KEEP (the newest ones).
  const keysToDelete: string[] = [];
  for (let i = allBackups.length - 1; i >= 0; i--) {
    const backup = allBackups[i];
    const remaining = allBackups.length - keysToDelete.length;

    // Safety: never delete below minimum
    if (remaining <= MIN_BACKUPS_TO_KEEP) break;

    if (backup.lastModified < cutoffDate) {
      keysToDelete.push(backup.key);
    }
  }

  if (keysToDelete.length === 0) {
    return {
      totalBackups: allBackups.length,
      deleted: 0,
      kept: allBackups.length,
    };
  }

  const result = await deleteMultipleFromR2(keysToDelete);

  return {
    totalBackups: allBackups.length,
    deleted: result.deleted,
    kept: allBackups.length - result.deleted,
  };
}

/**
 * Check if today's backup already exists in R2.
 * Used for restart safety — skip if already backed up today.
 */
export async function todayBackupExists(): Promise<boolean> {
  const today = new Date();
  const datePrefix = [
    today.getUTCFullYear(),
    String(today.getUTCMonth() + 1).padStart(2, '0'),
    String(today.getUTCDate()).padStart(2, '0'),
  ].join('-');

  const searchPrefix = `${BACKUP_PREFIX}redprint-db-${datePrefix}`;
  const files = await listR2Files(searchPrefix);

  return files.length > 0;
}
