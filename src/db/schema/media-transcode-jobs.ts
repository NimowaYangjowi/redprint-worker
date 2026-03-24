/**
 * Media Transcode Jobs Table
 * Queue for local-only media transcoding pipeline.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { assetMedia } from './asset-media';

/** Job type enum values */
export const jobTypeValues = ['video_mp4', 'video_hevc'] as const;
export type JobType = (typeof jobTypeValues)[number];

/** Job status enum values */
export const jobStatusValues = ['queued', 'processing', 'completed', 'failed', 'dead_letter'] as const;
export type JobStatus = (typeof jobStatusValues)[number];

export const mediaTranscodeJobs = pgTable(
  'media_transcode_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /** Source media reference */
    mediaId: text('media_id')
      .notNull()
      .references(() => assetMedia.id, { onDelete: 'cascade' }),

    /** Job type: video_mp4, video_hevc */
    jobType: text('job_type').notNull(),

    /** Job status: queued, processing, completed, failed, dead_letter */
    status: text('status').notNull().default('queued'),

    /** Idempotency key: {mediaId}_{jobType} — prevents duplicate jobs */
    idempotencyKey: text('idempotency_key').notNull(),

    /** Number of retries attempted */
    retryCount: integer('retry_count').notNull().default(0),

    /** Max retries before dead_letter */
    maxRetries: integer('max_retries').notNull().default(3),

    /** When the current processing lease expires */
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),

    /** When processing started */
    startedAt: timestamp('started_at', { withTimezone: true }),

    /** When processing completed */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** Last error message */
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusLeaseIdx: index('idx_transcode_jobs_status_lease').on(table.status, table.leaseExpiresAt),
    mediaIdIdx: index('idx_transcode_jobs_media_id').on(table.mediaId),
    idempotencyIdx: uniqueIndex('idx_transcode_jobs_idempotency').on(table.idempotencyKey),
  })
);

export type MediaTranscodeJob = typeof mediaTranscodeJobs.$inferSelect;
export type NewMediaTranscodeJob = typeof mediaTranscodeJobs.$inferInsert;
