/**
 * Tagging Job Results Schema
 * Stores individual image processing results for tagging jobs
 */

import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { taggingJobs } from './tagging-jobs';

// ============================================================
// Table: tagging_job_results
// ============================================================

export const taggingJobResults = pgTable(
  'tagging_job_results',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // Relations
    // Note: job_id has FK, but media_id FK was removed in
    // 20251217140754_remove_tagging_jobs_model_id_fk.sql to allow
    // both model_media and editor_images IDs
    jobId: uuid('job_id')
      .notNull()
      .references(() => taggingJobs.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),

    // Status
    status: text('status').notNull().default('pending'),

    // Tagging results (cached, will be copied to model_media)
    // tags: JSONB array of tag objects
    // tag_ids: TEXT[] array of tag UUIDs for foreign key references
    tags: jsonb('tags'),
    tagIds: text('tag_ids').array(),

    // NSFW detection results
    // These map to model_media fields:
    //   is_nsfw      -> model_media.falconsai_is_nsfw
    //   nsfw_score   -> model_media.falconsai_nsfw_score
    isNsfw: boolean('is_nsfw'),
    nsfwScore: text('nsfw_score'), // DECIMAL(5,4) stored as text for precision

    // WD tagger rating
    wdRating: text('wd_rating'),
    wdRatingScore: text('wd_rating_score'), // DECIMAL(5,4) stored as text

    // Error
    errorMessage: text('error_message'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    // Indexes
    index('idx_job_results_job_id').on(table.jobId),
    index('idx_job_results_media_id').on(table.mediaId),
    index('idx_job_results_status').on(table.status),

    // Unique constraint (one result per media per job)
    unique('tagging_job_results_job_id_media_id_key').on(table.jobId, table.mediaId),
  ]
);

// ============================================================
// Type Exports
// ============================================================

export type TaggingJobResult = typeof taggingJobResults.$inferSelect;
export type NewTaggingJobResult = typeof taggingJobResults.$inferInsert;

// Valid status values (for type safety)
export const TAGGING_RESULT_STATUS = ['pending', 'processing', 'completed', 'failed'] as const;
export type TaggingResultStatus = (typeof TAGGING_RESULT_STATUS)[number];

// Note: WdRating type is exported from model-media.ts to avoid duplicates
