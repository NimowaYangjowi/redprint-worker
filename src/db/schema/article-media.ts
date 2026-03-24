/**
 * Article Media Schema
 * Manages media uploaded to article editor (images/videos)
 * - R2 storage integration
 * - NSFW detection support
 * - Representative media selection
 */

import { createId } from '@paralleldrive/cuid2';
import { boolean, index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { articles } from './articles';

// Media Types
export const mediaTypeEnum = ['image', 'video'] as const;
export type MediaType = (typeof mediaTypeEnum)[number];

// Upload Status (prefixed to avoid conflicts with model-files.ts)
export const articleUploadStatusEnum = ['pending', 'completed', 'failed'] as const;
export type ArticleUploadStatus = (typeof articleUploadStatusEnum)[number];

// NSFW Status
export const articleNsfwStatusEnum = ['pending', 'processing', 'completed', 'failed'] as const;
export type ArticleNsfwStatus = (typeof articleNsfwStatusEnum)[number];

// Review Status (prefixed to avoid conflicts with model-media.ts)
export const articleReviewStatusEnum = ['pending', 'approved', 'rejected'] as const;
export type ArticleReviewStatus = (typeof articleReviewStatusEnum)[number];

// Tagging Status (prefixed to avoid conflicts with model-media.ts)
export const articleTaggingStatusEnum = ['pending', 'processing', 'completed', 'failed'] as const;
export type ArticleTaggingStatus = (typeof articleTaggingStatusEnum)[number];

// Article Media Table
export const articleMedia = pgTable(
  'article_media',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    articleId: text('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),

    // R2 Storage Info
    r2Key: text('r2_key').notNull(),
    r2Url: text('r2_url').notNull(),

    // File Metadata
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull(),
    mediaType: text('media_type').notNull().default('image'),

    // Upload Status
    uploadStatus: text('upload_status').notNull().default('pending'),

    // Representative Flag
    isRepresentative: boolean('is_representative').notNull().default(false),

    // NSFW Detection
    nsfwStatus: text('nsfw_status').default('pending'),
    nsfwScore: numeric('nsfw_score', { precision: 5, scale: 4 }),

    // AI Tagging (optional for articles)
    tags: text('tags').array(),
    tagIds: text('tag_ids').array(),
    taggingStatus: text('tagging_status').default('pending'),
    wdRating: text('wd_rating'),

    // Admin Review
    reviewStatus: text('review_status').default('pending'),
    rejectionReason: text('rejection_reason'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_article_media_article_id').on(table.articleId),
    index('idx_article_media_upload_status').on(table.uploadStatus),
  ]
);

// Type exports
export type ArticleMedia = typeof articleMedia.$inferSelect;
export type NewArticleMedia = typeof articleMedia.$inferInsert;
