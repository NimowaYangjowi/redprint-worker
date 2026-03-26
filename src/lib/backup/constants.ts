/**
 * DB Backup Constants
 * Operational parameters for the automated PostgreSQL backup system.
 */

// ============================================================================
// Backup Schedule
// ============================================================================

/** Default backup hour in UTC (04:00 = KST 13:00) */
export const DEFAULT_BACKUP_HOUR_UTC = 4;

/** R2 key prefix for legacy v1 backup files */
export const BACKUP_PREFIX_V1 = 'backups/';

/** R2 key prefix for v2 verified backup files */
export const BACKUP_PREFIX = 'backups/v2/';

/** Backup file name prefix */
export const BACKUP_FILE_PREFIX = 'redprint-db-';

/** Current backup format version */
export const BACKUP_FORMAT_VERSION = 'v2';

// ============================================================================
// Retention
// ============================================================================

/** Default number of days to keep backups */
export const DEFAULT_RETENTION_DAYS = 7;

/** Minimum number of backups to always keep (safety net) */
export const MIN_BACKUPS_TO_KEEP = 1;

// ============================================================================
// Operational Limits
// ============================================================================

/** Maximum backup file size before upload (500 MB) */
export const MAX_BACKUP_SIZE_BYTES = 500 * 1024 * 1024;

/** Timeout for pg_dump child process (10 minutes) */
export const PG_DUMP_TIMEOUT_MS = 10 * 60 * 1000;

/** Timeout for gzip integrity check (60 seconds) */
export const GZIP_VERIFY_TIMEOUT_MS = 60 * 1000;

/** Timeout for psql restore during verification (5 minutes) */
export const PSQL_RESTORE_TIMEOUT_MS = 5 * 60 * 1000;

/** Graceful shutdown wait for running backup (30 seconds) */
export const BACKUP_SHUTDOWN_TIMEOUT_MS = 30_000;

// ============================================================================
// Environment Helpers
// ============================================================================

/** Check if backup is enabled */
export const isBackupEnabled = () =>
  process.env.BACKUP_ENABLED === 'true';

/** Get admin database URL for backup verification (CREATE/DROP DATABASE) */
export const getBackupAdminDatabaseUrl = (): string | undefined =>
  process.env.BACKUP_ADMIN_DATABASE_URL;

/** Get dedicated verify database URL for daily restore verification */
export const getBackupVerifyDatabaseUrl = (): string | undefined =>
  process.env.BACKUP_VERIFY_DATABASE_URL;

/** Get configured backup hour (UTC) */
export const getBackupHourUTC = (): number => {
  const hour = parseInt(process.env.BACKUP_HOUR_UTC ?? '', 10);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23
    ? hour
    : DEFAULT_BACKUP_HOUR_UTC;
};

/** Get configured retention days */
export const getRetentionDays = (): number => {
  const days = parseInt(process.env.BACKUP_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(days) && days >= 1
    ? days
    : DEFAULT_RETENTION_DAYS;
};
