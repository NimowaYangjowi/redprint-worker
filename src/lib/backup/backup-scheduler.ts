/**
 * Backup Scheduler
 * Orchestrates daily database backups using a setTimeout chain.
 *
 * Schedule pattern:
 *   1. Calculate ms until next backup hour
 *   2. setTimeout for that duration
 *   3. Run backup (pg_dump → gzip → verify → upload → retention)
 *   4. Schedule next backup (repeat from step 1)
 *
 * Restart safety:
 *   On start, checks R2 for today's backup. If exists, skips to next day.
 *
 * Graceful shutdown:
 *   stop() cancels the pending timer. If a backup is in progress,
 *   waits up to BACKUP_SHUTDOWN_TIMEOUT_MS for completion.
 */

import { isBackupEnabled, getBackupHourUTC, BACKUP_SHUTDOWN_TIMEOUT_MS } from './constants';
import { runPgDump } from './pg-dump';
import { uploadBackup } from './backup-uploader';
import { applyRetention, todayBackupExists } from './retention';

let timer: ReturnType<typeof setTimeout> | null = null;
let backupInProgress = false;
let stopped = false;

/**
 * Start the backup scheduler.
 * Calculates time until next backup and sets a timer.
 */
export async function startBackupScheduler(): Promise<void> {
  if (!isBackupEnabled()) {
    console.log('[BACKUP] Backup is disabled (BACKUP_ENABLED != true)');
    return;
  }

  stopped = false;
  const hour = getBackupHourUTC();
  console.log(`[BACKUP] Scheduler starting (daily at ${String(hour).padStart(2, '0')}:00 UTC)`);

  // Restart safety: check if today's backup already exists
  try {
    const exists = await todayBackupExists();
    if (exists) {
      console.log('[BACKUP] Today\'s backup already exists in R2. Scheduling for tomorrow.');
      scheduleNext(true);
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BACKUP] Failed to check existing backups: ${msg}`);
    // Continue anyway — schedule the backup
  }

  scheduleNext(false);
}

/**
 * Stop the backup scheduler.
 * If a backup is in progress, waits for completion (up to timeout).
 */
export async function stopBackupScheduler(): Promise<void> {
  stopped = true;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (!backupInProgress) {
    console.log('[BACKUP] Scheduler stopped (no backup in progress)');
    return;
  }

  // Wait for running backup to finish
  console.log(`[BACKUP] Waiting for running backup to finish (max ${BACKUP_SHUTDOWN_TIMEOUT_MS / 1000}s)...`);
  const deadline = Date.now() + BACKUP_SHUTDOWN_TIMEOUT_MS;
  while (backupInProgress && Date.now() < deadline) {
    await sleep(500);
  }

  if (backupInProgress) {
    console.warn('[BACKUP] Timeout waiting for backup to finish');
  } else {
    console.log('[BACKUP] Backup finished. Scheduler stopped.');
  }
}

/**
 * Schedule the next backup run.
 * @param skipToday - If true, schedule for tomorrow's backup hour
 */
function scheduleNext(skipToday: boolean): void {
  if (stopped) return;

  const delayMs = msUntilNextBackup(skipToday);
  const hours = (delayMs / 3_600_000).toFixed(1);
  console.log(`[BACKUP] Next backup in ${hours} hours`);

  timer = setTimeout(() => {
    timer = null;
    void executeBackup();
  }, delayMs);

  // Prevent timer from keeping the process alive
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}

/**
 * Calculate milliseconds until the next backup hour.
 */
function msUntilNextBackup(skipToday: boolean): number {
  const now = new Date();
  const hour = getBackupHourUTC();

  const target = new Date(now);
  target.setUTCHours(hour, 0, 0, 0);

  if (skipToday || target.getTime() <= now.getTime()) {
    // Target is in the past or we're skipping today — move to tomorrow
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Execute the full backup pipeline:
 * pg_dump → gzip → verify → upload → retention
 */
async function executeBackup(): Promise<void> {
  if (stopped) return;

  backupInProgress = true;
  const startTime = Date.now();
  console.log('[BACKUP] Starting backup...');

  try {
    // Step 1: pg_dump → gzip → temp file
    console.log('[BACKUP] Running pg_dump...');
    const tempPath = await runPgDump();

    // Step 2: Upload to R2
    console.log('[BACKUP] Uploading to R2...');
    const { key, size } = await uploadBackup(tempPath);
    const sizeMB = (size / 1024 / 1024).toFixed(1);
    console.log(`[BACKUP] Uploaded: ${key} (${sizeMB} MB)`);

    // Step 3: Apply retention policy
    console.log('[BACKUP] Applying retention policy...');
    try {
      const retention = await applyRetention();
      console.log(
        `[BACKUP] Retention: ${retention.deleted} deleted, ${retention.kept} kept`
      );
    } catch (retErr) {
      // Retention failure is non-critical — backup itself succeeded
      const msg = retErr instanceof Error ? retErr.message : String(retErr);
      console.error(`[BACKUP] Retention failed (backup is safe): ${msg}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[BACKUP] Backup completed in ${elapsed}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BACKUP] Backup failed: ${msg}`);
  } finally {
    backupInProgress = false;

    // Schedule next backup
    scheduleNext(true);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export for testing
export { msUntilNextBackup as _msUntilNextBackup, executeBackup as _executeBackup };
