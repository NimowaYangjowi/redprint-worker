/**
 * Tagging Jobs Schema
 * Manages batch tagging job requests for Cloud Run tagging-service
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// ============================================================
// Queue Type Constants
// ============================================================

// Queue type discriminator: FIFO vs Batch
export const TAGGING_QUEUE_TYPE = ['fifo', 'batch'] as const;
export type TaggingQueueType = (typeof TAGGING_QUEUE_TYPE)[number];

// ============================================================
// Table: tagging_jobs
// ============================================================

export const taggingJobs = pgTable(
  'tagging_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // Status: queued -> processing -> completed/failed
    status: text('status').notNull().default('queued'),

    // === Batch mode fields (legacy) ===
    // Target media for batch processing (TEXT[] because model_media.id is TEXT)
    mediaIds: text('media_ids').array(), // Made nullable for FIFO mode
    imageCount: integer('image_count').notNull(),

    // === FIFO mode fields (new) ===
    // Session grouping
    sessionId: text('session_id'),
    // Queue discriminator
    queueType: text('queue_type').notNull().default('batch'),
    // Single media for FIFO processing
    singleMediaId: text('single_media_id'),
    // Precise queue time for FIFO ordering
    queuedAt: timestamp('queued_at', { withTimezone: true }).defaultNow(),
    // When processing started
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),

    // === Common fields ===
    // Progress tracking
    processedCount: integer('processed_count').default(0),
    failedCount: integer('failed_count').default(0),

    // Retry configuration
    retryCount: integer('retry_count').default(0),
    maxRetries: integer('max_retries').default(3),

    // Error information
    errorMessage: text('error_message'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Request metadata
    requestedBy: text('requested_by'),
    priority: text('priority').default('normal'),
    webhookUrl: text('webhook_url'),

    // Asset/Version tracking (added in later migrations)
    // Note: FK removed in 20251217140754_remove_tagging_jobs_model_id_fk.sql
    assetId: text('asset_id'),
    autoPublish: boolean('auto_publish').default(true),
    versionId: text('version_id'),

    // === Lease mechanism (Phase 2A: lease-based stale detection) ===
    // Timestamp when the current processing lease expires; null = not leased
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    // UUID set on claim, validated on completion — prevents stale worker writes after requeue
    leaseToken: text('lease_token'),
  },
  (table) => [
    // === Existing indexes ===
    index('idx_tagging_jobs_status').on(table.status),
    index('idx_tagging_jobs_status_created').on(table.status, table.createdAt),
    index('idx_tagging_jobs_created_at').on(table.createdAt),
    index('idx_tagging_jobs_asset_id').on(table.assetId),
    index('idx_tagging_jobs_version_id').on(table.versionId),

    // Partial unique index to prevent duplicate active jobs per asset (batch mode)
    // @see 20260125205815_add_unique_active_tagging_job_per_model.sql
    uniqueIndex('idx_tagging_jobs_active_asset')
      .on(table.assetId)
      .where(sql`status IN ('queued', 'processing')`),

    // === New FIFO indexes ===
    // FIFO queue processing order
    index('idx_tagging_jobs_fifo_queue')
      .on(table.queuedAt)
      .where(sql`status = 'queued' AND queue_type = 'fifo'`),

    // Session-based lookups
    index('idx_tagging_jobs_session_status')
      .on(table.sessionId, table.status)
      .where(sql`session_id IS NOT NULL`),
  ]
);

// ============================================================
// Type Exports
// ============================================================

export type TaggingJob = typeof taggingJobs.$inferSelect;
export type NewTaggingJob = typeof taggingJobs.$inferInsert;

// Valid status values (for type safety)
export const TAGGING_JOB_STATUS = ['queued', 'processing', 'completed', 'failed', 'dead_letter'] as const;
export type TaggingJobStatus = (typeof TAGGING_JOB_STATUS)[number];

// Valid priority values
export const TAGGING_JOB_PRIORITY = ['low', 'normal', 'high'] as const;
export type TaggingJobPriority = (typeof TAGGING_JOB_PRIORITY)[number];
