/**
 * Backup Logs Table
 * Tracks database backup execution history for monitoring dashboard.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';

/** Backup status enum values */
export const backupStatusValues = ['running', 'success', 'failed'] as const;
export type BackupStatus = (typeof backupStatusValues)[number];

export const backupLogs = pgTable(
  'backup_logs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /** Backup status: running, success, failed */
    status: text('status').notNull(),

    /** R2 object key (set on success) */
    r2Key: text('r2_key'),

    /** Backup file size in bytes */
    fileSize: integer('file_size'),

    /** Total duration in milliseconds */
    durationMs: integer('duration_ms'),

    /** Number of backups kept after retention */
    retentionKept: integer('retention_kept'),

    /** Number of backups deleted by retention */
    retentionDeleted: integer('retention_deleted'),

    /** Error message on failure */
    errorMessage: text('error_message'),

    /** When the backup started */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),

    /** When the backup completed (success or failure) */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    startedAtIdx: index('idx_backup_logs_started_at').on(table.startedAt),
  })
);

export type BackupLog = typeof backupLogs.$inferSelect;
export type NewBackupLog = typeof backupLogs.$inferInsert;
