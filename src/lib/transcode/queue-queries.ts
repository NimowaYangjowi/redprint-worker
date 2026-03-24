/**
 * Transcode Queue Query Functions
 * DB-direct access via Drizzle ORM for the local-only transcoding pipeline.
 *
 * Used by:
 * - Vercel API routes (enqueue only)
 * - Local worker (claim, heartbeat, complete, fail, requeueStale)
 */

import { createId } from '@paralleldrive/cuid2';
import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '@/db';
import { assetMedia, mediaTranscodeJobs, mediaVariants } from '@/db/schema';

import { LEASE_DURATION_MS, DEFAULT_MAX_RETRIES } from './constants';

// ============================================================================
// Status mapping helper
// ============================================================================

/** Maps job status to asset_media transcodeStatus */
export function toTranscodeStatus(jobStatus: string): string {
  switch (jobStatus) {
  case 'queued': return 'pending';
  case 'processing': return 'processing';
  case 'completed': return 'completed';
  case 'failed':
  case 'dead_letter': return 'failed';
  default: return 'pending';
  }
}

// ============================================================================
// Enqueue
// ============================================================================

/**
 * Enqueue a transcode job (idempotent).
 * If a job with the same idempotencyKey already exists, returns null (no-op).
 * Also sets asset_media.transcodeStatus = 'pending'.
 */
export async function enqueue(mediaId: string, jobType: string) {
  const idempotencyKey = `${mediaId}_${jobType}`;

  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(mediaTranscodeJobs)
      .values({
        mediaId,
        jobType,
        idempotencyKey,
        maxRetries: DEFAULT_MAX_RETRIES,
      })
      .onConflictDoNothing()
      .returning();

    if (!job) return null;

    await tx
      .update(assetMedia)
      .set({ transcodeStatus: 'pending' })
      .where(eq(assetMedia.id, mediaId));

    return job;
  });
}

// ============================================================================
// Claim
// ============================================================================

/**
 * Claim the oldest queued/failed job using FOR UPDATE SKIP LOCKED.
 * Sets status to 'processing', records startedAt and lease expiry.
 * Returns the claimed job or null if queue is empty.
 */
export async function claim() {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; media_id: string }>(
      sql`SELECT id, media_id FROM media_transcode_jobs
          WHERE status IN ('queued', 'failed')
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`
    );

    if (rows.length === 0) return null;

    const row = rows[0];

    const [claimed] = await tx
      .update(mediaTranscodeJobs)
      .set({
        status: 'processing',
        startedAt: now,
        leaseExpiresAt,
        errorMessage: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(mediaTranscodeJobs.id, row.id))
      .returning();

    await tx
      .update(assetMedia)
      .set({ transcodeStatus: 'processing' })
      .where(eq(assetMedia.id, row.media_id));

    return claimed;
  });
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * Extend lease on a processing job.
 * Returns true if lease was extended, false if job not found or not processing.
 */
export async function heartbeat(jobId: string, expectedStartedAt: Date) {
  const now = new Date();
  const newLease = new Date(now.getTime() + LEASE_DURATION_MS);

  const result = await db
    .update(mediaTranscodeJobs)
    .set({
      leaseExpiresAt: newLease,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaTranscodeJobs.id, jobId),
        eq(mediaTranscodeJobs.status, 'processing'),
        eq(mediaTranscodeJobs.startedAt, expectedStartedAt)
      )
    )
    .returning({ id: mediaTranscodeJobs.id });

  return result.length > 0;
}

// ============================================================================
// Complete
// ============================================================================

export interface CompleteParams {
  jobId: string;
  mediaId: string;
  jobType: string;
  expectedStartedAt: Date;
  variantR2Key: string;
  variantR2Url: string;
  thumbnailR2Url?: string;
  fileSize: number;
  format: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface CompleteResult {
  applied: boolean;
}

/**
 * Mark job as completed, create variant record, and sync asset_media status.
 * Uses (jobId + startedAt + processing) fence so stale workers can't overwrite newer attempts.
 * All in one transaction for atomicity.
 */
export async function complete(params: CompleteParams): Promise<CompleteResult> {
  const now = new Date();
  const variantId = createId();

  return db.transaction(async (tx) => {
    const [updatedJob] = await tx
      .update(mediaTranscodeJobs)
      .set({
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaTranscodeJobs.id, params.jobId),
          eq(mediaTranscodeJobs.status, 'processing'),
          eq(mediaTranscodeJobs.startedAt, params.expectedStartedAt),
        )
      )
      .returning({ id: mediaTranscodeJobs.id });

    if (!updatedJob) {
      return { applied: false };
    }

    await tx
      .insert(mediaVariants)
      .values({
        id: variantId,
        mediaId: params.mediaId,
        variantType: params.jobType,
        r2Key: params.variantR2Key,
        r2Url: params.variantR2Url,
        fileSize: params.fileSize,
        format: params.format,
        width: params.width ?? null,
        height: params.height ?? null,
        duration: params.duration ?? null,
      })
      .onConflictDoUpdate({
        target: [mediaVariants.mediaId, mediaVariants.variantType],
        set: {
          r2Key: params.variantR2Key,
          r2Url: params.variantR2Url,
          fileSize: params.fileSize,
          format: params.format,
          width: params.width ?? null,
          height: params.height ?? null,
          duration: params.duration ?? null,
        },
      });

    const mediaUpdate: {
      transcodeStatus: 'completed';
      thumbnailUrl?: string;
    } = { transcodeStatus: 'completed' };
    if (params.thumbnailR2Url) {
      mediaUpdate.thumbnailUrl = params.thumbnailR2Url;
    }

    await tx
      .update(assetMedia)
      .set(mediaUpdate)
      .where(eq(assetMedia.id, params.mediaId));

    return { applied: true };
  });
}

// ============================================================================
// Fail
// ============================================================================

/**
 * Mark job as failed.
 * - If retryCount >= maxRetries, move to dead_letter
 * - Otherwise keep status='failed' (claim() retries failed jobs)
 * Uses (jobId + startedAt + processing) fence so stale workers can't overwrite newer attempts.
 * Syncs asset_media.transcodeStatus:
 * - failed when dead_letter
 * - pending when retryable
 */
export async function fail(jobId: string, errorMessage: string, expectedStartedAt: Date) {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        id: mediaTranscodeJobs.id,
        mediaId: mediaTranscodeJobs.mediaId,
        status: mediaTranscodeJobs.status,
        retryCount: mediaTranscodeJobs.retryCount,
        maxRetries: mediaTranscodeJobs.maxRetries,
      })
      .from(mediaTranscodeJobs)
      .where(eq(mediaTranscodeJobs.id, jobId));

    if (!job) return null;
    if (job.status !== 'processing') return null;

    const newRetryCount = job.retryCount + 1;
    const newStatus = newRetryCount >= job.maxRetries ? 'dead_letter' : 'failed';

    const [updatedJob] = await tx
      .update(mediaTranscodeJobs)
      .set({
        status: newStatus,
        retryCount: newRetryCount,
        errorMessage,
        leaseExpiresAt: null,
        startedAt: null,
        completedAt: newStatus === 'dead_letter' ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaTranscodeJobs.id, jobId),
          eq(mediaTranscodeJobs.status, 'processing'),
          eq(mediaTranscodeJobs.startedAt, expectedStartedAt),
        )
      )
      .returning({ id: mediaTranscodeJobs.id });

    if (!updatedJob) return null;

    const transcodeStatus = newStatus === 'dead_letter' ? 'failed' : 'pending';
    await tx
      .update(assetMedia)
      .set({ transcodeStatus })
      .where(eq(assetMedia.id, job.mediaId));

    return { jobId, status: newStatus, retryCount: newRetryCount };
  });
}

// ============================================================================
// Requeue Stale
// ============================================================================

/**
 * Find processing jobs where lease has expired and requeue them.
 * Sets status back to 'queued', clears lease, and syncs asset_media.
 * Returns the number of requeued jobs.
 */
export async function requeueStale() {
  const now = new Date();

  const staleJobs = await db
    .select({
      id: mediaTranscodeJobs.id,
      mediaId: mediaTranscodeJobs.mediaId,
    })
    .from(mediaTranscodeJobs)
    .where(
      and(
        eq(mediaTranscodeJobs.status, 'processing'),
        lt(mediaTranscodeJobs.leaseExpiresAt, now)
      )
    );

  if (staleJobs.length === 0) return 0;
  let requeuedCount = 0;

  for (const job of staleJobs) {
    await db.transaction(async (tx) => {
      const [updatedJob] = await tx
        .update(mediaTranscodeJobs)
        .set({
          status: 'queued',
          leaseExpiresAt: null,
          startedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(mediaTranscodeJobs.id, job.id),
            eq(mediaTranscodeJobs.status, 'processing'),
            lt(mediaTranscodeJobs.leaseExpiresAt, now),
          )
        )
        .returning({ id: mediaTranscodeJobs.id });

      if (!updatedJob) return;

      await tx
        .update(assetMedia)
        .set({ transcodeStatus: 'pending' })
        .where(eq(assetMedia.id, job.mediaId));

      requeuedCount++;
    });
  }

  return requeuedCount;
}
