/**
 * Backup Scheduler – v2 Verified Backup
 * Orchestrates daily database backups with remote restore verification.
 *
 * Pipeline:
 *   1. log start
 *   2. generate local dump (v2 COPY format)
 *   3. upload to R2 v2 path
 *   4. verify by re-reading remote object into the dedicated verify DB
 *   5. apply v2 retention
 *   6. write success log only after verify passes
 *
 * Success definition:
 *   `status='success'` means the remote object was downloaded again and
 *   restored into the dedicated verify DB via `psql` without errors.
 *
 * Restart safety:
 *   On start, checks R2 v2 prefix for today's backup. If exists, skips.
 *
 * Graceful shutdown:
 *   stop() cancels the pending timer. If a backup is in progress,
 *   waits up to BACKUP_SHUTDOWN_TIMEOUT_MS for completion.
 */

import { isBackupEnabled, getBackupHourUTC, BACKUP_SHUTDOWN_TIMEOUT_MS } from './constants';
import { runPgDump } from './pg-dump';
import { uploadBackup } from './backup-uploader';
import { verifyBackupFromR2 } from './backup-verify';
import { applyRetention, todayBackupExists } from './retention';
import {
  logBackupStart,
  logBackupUploadComplete,
  logBackupSuccess,
  logBackupFailed,
} from './backup-logger';

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
  console.log(`[BACKUP] v2 scheduler starting (daily at ${String(hour).padStart(2, '0')}:00 UTC)`);

  // Restart safety: check if today's backup already exists in v2 prefix
  try {
    const exists = await todayBackupExists();
    if (exists) {
      console.log('[BACKUP] Today\'s v2 backup already exists in R2. Scheduling for tomorrow.');
      scheduleNext(true);
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BACKUP] Failed to check existing backups: ${msg}`);
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
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Execute the full v2 backup pipeline:
 * dump → upload → verify from remote → retention → success log
 *
 * Success is only written when remote restore verification passes.
 */
async function executeBackup(options: { skipRetention?: boolean } = {}): Promise<void> {
  if (stopped) return;

  backupInProgress = true;
  const startTime = Date.now();
  console.log('[BACKUP] Starting v2 verified backup...');

  let logId: string | null = null;
  try {
    logId = await logBackupStart();
  } catch (logErr) {
    console.error('[BACKUP] Failed to log backup start:', logErr);
  }

  try {
    // Step 1: Generate local dump (v2 COPY format)
    console.log('[BACKUP] Running pg_dump (v2 COPY format)...');
    const tempPath = await runPgDump();

    // Step 2: Upload to R2 v2 path
    console.log('[BACKUP] Uploading to R2 (v2 path)...');
    const { key, size } = await uploadBackup(tempPath);
    const sizeMB = (size / 1024 / 1024).toFixed(1);
    console.log(`[BACKUP] Uploaded: ${key} (${sizeMB} MB)`);

    if (logId) {
      try {
        await logBackupUploadComplete(logId, key);
      } catch (logErr) {
        console.error('[BACKUP] Failed to log upload completion:', logErr);
      }
    }

    // Step 3: Verify by re-reading the remote object into the dedicated verify DB
    console.log('[BACKUP] Verifying backup from remote R2 object...');
    const verifyResult = await verifyBackupFromR2(key);

    if (!verifyResult.passed) {
      throw new Error(
        `Remote restore verification failed: ${verifyResult.error ?? 'unknown error'}`
      );
    }

    const verifyElapsed = (verifyResult.durationMs / 1000).toFixed(1);
    console.log(
      `[BACKUP] Verification passed (verify DB: ${verifyResult.verifyDbName}, ${verifyElapsed}s)`
    );

    // Step 4: Apply v2 retention policy unless this is a rollout smoke run
    let retentionKept: number | undefined;
    let retentionDeleted: number | undefined;
    if (options.skipRetention) {
      console.log('[BACKUP] Skipping retention for this manual rollout smoke run');
    } else {
      console.log('[BACKUP] Applying retention policy...');
      try {
        const retention = await applyRetention();
        retentionKept = retention.kept;
        retentionDeleted = retention.deleted;
        console.log(
          `[BACKUP] Retention: ${retention.deleted} deleted, ${retention.kept} kept`
        );
      } catch (retErr) {
        const msg = retErr instanceof Error ? retErr.message : String(retErr);
        console.error(`[BACKUP] Retention failed (backup is safe): ${msg}`);
      }
    }

    // Step 5: Write success log — only after verification passed
    const durationMs = Date.now() - startTime;
    const elapsed = (durationMs / 1000).toFixed(1);
    console.log(`[BACKUP] Verified backup completed in ${elapsed}s`);

    if (logId) {
      try {
        await logBackupSuccess(logId, {
          r2Key: key,
          fileSize: size,
          durationMs,
          retentionKept,
          retentionDeleted,
          verifiedFromR2Key: key,
        });
      } catch (logErr) {
        console.error('[BACKUP] Failed to log backup success:', logErr);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BACKUP] Backup failed: ${msg}`);

    // Determine if this was a verification failure
    const verificationFailed = msg.includes('Remote restore verification failed');

    if (logId) {
      try {
        await logBackupFailed(logId, msg, Date.now() - startTime, verificationFailed);
      } catch (logErr) {
        console.error('[BACKUP] Failed to log backup failure:', logErr);
      }
    }
  } finally {
    backupInProgress = false;
    scheduleNext(true);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export for testing
export { msUntilNextBackup as _msUntilNextBackup, executeBackup as _executeBackup };
