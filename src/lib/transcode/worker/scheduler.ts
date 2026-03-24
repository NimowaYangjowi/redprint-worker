/**
 * Adaptive Polling Scheduler
 * Implements exponential backoff when the queue is empty,
 * resets to base interval when a job is claimed.
 */

import { POLL_BASE_MS, POLL_MAX_MS, POLL_BACKOFF_FACTOR } from '../constants';

export class Scheduler {
  private currentDelay = POLL_BASE_MS;

  /** Get the next delay (ms) before polling again */
  get delay(): number {
    return this.currentDelay;
  }

  /** Call when a job was successfully claimed — reset to fast polling */
  reset(): void {
    this.currentDelay = POLL_BASE_MS;
  }

  /** Call when the queue was empty — increase backoff */
  onEmpty(): void {
    this.currentDelay = Math.min(
      Math.round(this.currentDelay * POLL_BACKOFF_FACTOR),
      POLL_MAX_MS
    );
  }
}
