/**
 * Temp Media Table Schema
 * Tracks temporary R2 uploads for preview tagging before final submission.
 *
 * Lifecycle:
 * 1. User adds image to preview -> temp upload to R2 -> temp_media record created
 * 2. AI tagging runs -> tags stored in temp_media
 * 3. Final submission -> temp_media linked to asset_media via assetId
 * 4. Orphan cleanup -> records with expiresAt < now AND assetId IS NULL deleted
 *
 * @see plans/2026-02-05_local-preview-tagging/PLAN.md
 */

import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  bigint,
  boolean,
  jsonb,
  index,
  real,
} from 'drizzle-orm/pg-core';

import type { RawTagData, WdRating } from './asset-media';

/**
 * Temp Media Upload Status
 * uploading -> completed | failed
 */
export const tempMediaUploadStatus = ['uploading', 'completed', 'failed'] as const;
export type TempMediaUploadStatus = (typeof tempMediaUploadStatus)[number];

/**
 * Temp Media Tagging Status
 * pending -> processing -> completed | failed | skipped
 */
export const tempMediaTaggingStatus = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const;
export type TempMediaTaggingStatus = (typeof tempMediaTaggingStatus)[number];

export const tempMedia = pgTable(
  'temp_media',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // User who uploaded (Clerk user ID)
    userId: text('user_id').notNull(),

    // R2 Storage info
    r2Key: text('r2_key').notNull(),  // temp/{userId}/{cuid2}/{filename}
    r2Url: text('r2_url').notNull(),  // Public URL for tagging service

    // File metadata
    fileName: text('file_name').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    mimeType: text('mime_type').notNull(),

    // Upload status
    uploadStatus: text('upload_status').$type<TempMediaUploadStatus>().default('uploading'),

    // ========== Tagging Results ==========
    // AI-detected tags (same format as asset_media.tags)
    tags: jsonb('tags').$type<RawTagData[]>().default([]),

    // WD Tagger content rating
    wdRating: text('wd_rating').$type<WdRating>(),

    // WD Tagger rating confidence score (0.0-1.0)
    wdRatingScore: real('wd_rating_score'),

    // NSFW detection result
    isNsfw: boolean('is_nsfw'),

    // Tagging status
    taggingStatus: text('tagging_status').$type<TempMediaTaggingStatus>().default('pending'),

    // Timestamp when tagging completed
    taggedAt: timestamp('tagged_at', { withTimezone: true }),

    // Error message if tagging failed
    taggingErrorMessage: text('tagging_error_message'),

    // ========== Linking to Asset ==========
    // When temp media is used in final submission, link to asset
    // If assetId is set, orphan cleanup will skip this record
    assetId: text('asset_id'),

    // ========== Timestamps ==========
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // Auto-expiration for orphan cleanup (default: 24 hours from creation)
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .default(sql`NOW() + INTERVAL '24 hours'`)
      .notNull(),
  },
  (table) => ({
    // Index for user queries
    userIdIdx: index('idx_temp_media_user_id').on(table.userId),

    // Index for orphan cleanup cron query
    // Query: WHERE expires_at < NOW() AND asset_id IS NULL
    expiresAtIdx: index('idx_temp_media_expires_at').on(table.expiresAt),

    // Index for asset linking check
    assetIdIdx: index('idx_temp_media_asset_id').on(table.assetId),

    // Index for upload status queries
    uploadStatusIdx: index('idx_temp_media_upload_status').on(table.uploadStatus),

    // Index for tagging status queries
    taggingStatusIdx: index('idx_temp_media_tagging_status').on(table.taggingStatus),
  })
);

export type TempMedia = typeof tempMedia.$inferSelect;
export type NewTempMedia = typeof tempMedia.$inferInsert;
