/**
 * Backup Uploader
 * Reads a local backup file into a Buffer and uploads to R2.
 */

import { readFileSync, unlinkSync, existsSync } from 'node:fs';

import { uploadToR2 } from '../storage/r2-client';
import { BACKUP_PREFIX, BACKUP_FILE_PREFIX, MAX_BACKUP_SIZE_BYTES, BACKUP_FORMAT_VERSION } from './constants';

export interface BackupUploadResult {
  key: string;
  size: number;
}

/**
 * Format a date as YYYY-MM-DD-HHmmss
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    '-', pad(date.getUTCMonth() + 1),
    '-', pad(date.getUTCDate()),
    '-', pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

/**
 * Upload a local backup file to R2.
 * Deletes the local file after successful upload.
 *
 * @param localPath - Path to the .sql.gz file
 * @returns The R2 key and file size
 */
export async function uploadBackup(localPath: string): Promise<BackupUploadResult> {
  const buffer = readFileSync(localPath);

  if (buffer.length > MAX_BACKUP_SIZE_BYTES) {
    throw new Error(
      `Backup file too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB ` +
      `(max ${MAX_BACKUP_SIZE_BYTES / 1024 / 1024} MB)`
    );
  }

  const timestamp = formatTimestamp(new Date());
  const key = `${BACKUP_PREFIX}${BACKUP_FILE_PREFIX}${timestamp}.sql.gz`;

  const result = await uploadToR2({
    key,
    buffer,
    contentType: 'application/gzip',
    metadata: {
      'backup-type': 'pg_dump',
      'backup-format': 'copy-format-gzip',
      'backup-format-version': BACKUP_FORMAT_VERSION,
    },
  });

  // Cleanup local file after successful upload
  cleanupLocalFile(localPath);

  return { key: result.key, size: result.size };
}

/** Safely remove local file */
function cleanupLocalFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup — file is in /tmp anyway
  }
}
