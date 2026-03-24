/**
 * Periodic Stale Job Sweeper
 * Runs on an interval to reclaim jobs with expired leases.
 */

import { STALE_SWEEPER_INTERVAL_MS } from '../constants';
import { requeueStale } from '../queue-queries';

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start periodic stale sweeper. Returns cleanup function. */
export function startSweeper(): () => void {
  if (sweepTimer) return stopSweeper;

  sweepTimer = setInterval(() => {
    void (async () => {
      try {
        const count = await requeueStale();
        if (count > 0) {
          console.log(`[SWEEPER] Requeued ${count} stale job(s)`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[SWEEPER] Requeue failed: ${message}`);
      }
    })();
  }, STALE_SWEEPER_INTERVAL_MS);

  console.log(`[SWEEPER] Started (interval: ${STALE_SWEEPER_INTERVAL_MS / 1000}s)`);

  return stopSweeper;
}

/** Stop the sweeper interval */
export function stopSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    console.log('[SWEEPER] Stopped');
  }
}
