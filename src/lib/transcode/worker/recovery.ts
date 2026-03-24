/**
 * Startup Recovery
 * On worker start, requeue any stale processing jobs whose leases have expired.
 */

import { requeueStale } from '../queue-queries';

/** Recover stale jobs on startup. Returns the count of requeued jobs. */
export async function recoverStaleJobs(): Promise<number> {
  const count = await requeueStale();
  if (count > 0) {
    console.log(`[RECOVERY] Requeued ${count} stale job(s) on startup`);
  } else {
    console.log('[RECOVERY] No stale jobs found');
  }
  return count;
}
