/**
 * Worker Runner
 * Main loop: claim → process → complete/fail with heartbeat, graceful shutdown,
 * disk guard, and adaptive backoff.
 */

import { HEARTBEAT_INTERVAL_MS, GRACEFUL_SHUTDOWN_TIMEOUT_MS } from '../constants';
import { claim, complete, fail, heartbeat } from '../queue-queries';
import { startBackupScheduler, stopBackupScheduler } from '../../backup/backup-scheduler';

import { processJob, toCompleteParams } from './processor';
import { recoverStaleJobs } from './recovery';
import { Scheduler } from './scheduler';
import { startSweeper, stopSweeper } from './sweeper';
import { createTempDir, cleanupTempDir, hasSufficientDisk, getFreeDiskGB } from './temp-manager';

let running = false;
let shuttingDown = false;
let currentJobId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Start the worker loop */
export async function start(): Promise<void> {
  running = true;
  const scheduler = new Scheduler();

  console.log('[WORKER] Starting...');

  // 1. Recover stale jobs from previous runs
  await recoverStaleJobs();

  // 2. Start periodic stale sweeper
  startSweeper();

  // 2.5. Start backup scheduler
  await startBackupScheduler();

  // 3. Main loop
  console.log('[WORKER] Entering main loop');

  while (running) {
    // Check disk space before claiming
    if (!hasSufficientDisk()) {
      console.warn(`[WORKER] Low disk space (${getFreeDiskGB()} GB free). Pausing...`);
      await sleep(scheduler.delay);
      scheduler.onEmpty();
      continue;
    }

    // Claim next job
    const job = await claim();

    if (!job) {
      scheduler.onEmpty();
      await sleep(scheduler.delay);
      continue;
    }

    // Reset backoff — we have work
    scheduler.reset();
    currentJobId = job.id;
    const claimStartedAt =
      job.startedAt instanceof Date
        ? job.startedAt
        : new Date(job.startedAt ?? Date.now());

    console.log(`[WORKER] Claimed job ${job.id} (${job.jobType}) for media ${job.mediaId}`);

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          const ok = await heartbeat(job.id, claimStartedAt);
          if (!ok) {
            console.warn(`[WORKER] Heartbeat skipped for stale/reclaimed job ${job.id}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[WORKER] Heartbeat error for job ${job.id}: ${message}`);
        }
      })();
    }, HEARTBEAT_INTERVAL_MS);

    // Process the job
    const tempDir = createTempDir(job.id);
    try {
      const result = await processJob(
        { id: job.id, mediaId: job.mediaId, jobType: job.jobType },
        tempDir
      );

      const completion = await complete(toCompleteParams(
        { id: job.id, mediaId: job.mediaId, jobType: job.jobType, startedAt: claimStartedAt },
        result
      ));

      if (completion.applied) {
        console.log(`[WORKER] Completed job ${job.id}`);
      } else {
        console.warn(`[WORKER] Skipped completion for stale/reclaimed job ${job.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[WORKER] Job ${job.id} failed: ${message}`);
      const failResult = await fail(job.id, message, claimStartedAt);
      if (!failResult) {
        console.warn(`[WORKER] Skipped fail update for stale/reclaimed job ${job.id}`);
      }
    } finally {
      // Always cleanup
      stopHeartbeat();
      cleanupTempDir(job.id);
      currentJobId = null;
    }
  }

  console.log('[WORKER] Main loop exited');
}

/** Request graceful shutdown */
export async function stop(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[WORKER] Shutdown requested...');

  if (!currentJobId) {
    // No job running — exit immediately
    running = false;
    stopSweeper();
    await stopBackupScheduler();
    console.log('[WORKER] No active job. Exiting.');
    return;
  }

  // Wait for current job to finish (up to GRACEFUL_SHUTDOWN_TIMEOUT_MS)
  console.log(`[WORKER] Waiting for job ${currentJobId} to finish (max ${GRACEFUL_SHUTDOWN_TIMEOUT_MS / 1000}s)...`);

  const deadline = Date.now() + GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  while (currentJobId && Date.now() < deadline) {
    await sleep(500);
  }

  running = false;
  stopSweeper();
  await stopBackupScheduler();

  if (currentJobId) {
    console.warn(`[WORKER] Timeout waiting for job ${currentJobId}. Job will be reclaimed by sweeper.`);
  } else {
    console.log('[WORKER] Active job finished. Exiting cleanly.');
  }
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
