/**
 * Editor Images 테이블 스키마
 * TipTap 에디터에서 업로드된 이미지 관리
 * NSFW 감지 및 태깅 지원 (통합 태깅 Job)
 */

import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, integer, index, boolean, real, jsonb } from 'drizzle-orm/pg-core';

import { assetVersions } from './asset-versions';

import type { RawTagData, WdRating, ReviewStatus } from './asset-media';

export const editorImages = pgTable(
  'editor_images',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 연관 에셋
    // NOTE: DB compatibility
    // Legacy/current DB uses `model_id` column (not `asset_id`).
    // Keep property name as assetId for domain consistency.
    assetId: text('model_id').notNull(),

    // 연관 버전 (optional)
    versionId: text('version_id')
      .references(() => assetVersions.id, { onDelete: 'set null' }),

    // 리비전 참조 (for draft/published separation)
    // Note: FK constraint defined in DB migration (circular dependency with version-revisions)
    revisionId: text('revision_id'),

    // R2 정보
    r2Key: text('r2_key').notNull(),
    r2Url: text('r2_url').notNull(),

    // 파일 정보
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(), // bytes
    mimeType: text('mime_type').notNull(),

    // 업로드 상태
    uploadStatus: text('upload_status').notNull().default('pending'), // 'pending' | 'completed' | 'failed'

    // ========== NSFW Detection Fields (Falconsai) ==========
    falconsaiIsNsfw: boolean('falconsai_is_nsfw'),
    falconsaiNsfwScore: real('falconsai_nsfw_score'),
    falconsaiStatus: text('falconsai_status').default('pending'),

    // ========== Tagging Fields (WD Tagger) ==========
    // Raw tag data from AI detection
    tags: jsonb('tags').$type<RawTagData[]>().default([]),

    // Array of danbooru_tags.id for efficient search
    tagIds: text('tag_ids')
      .array()
      .default(sql`'{}'::text[]`),

    // Tagging status: pending → processing → completed | failed | skipped
    taggingStatus: text('tagging_status').default('pending'),

    // AI model used for tagging (e.g., wd-swinv2-tagger-v3)
    taggingModel: text('tagging_model'),

    // Timestamp when tagging was completed
    taggedAt: timestamp('tagged_at', { withTimezone: true }),

    // Error message if tagging failed
    taggingErrorMessage: text('tagging_error_message'),

    // WD Tagger content rating: explicit | questionable | safe
    wdRating: text('wd_rating').$type<WdRating>(),

    // WD Tagger rating confidence score (0.0-1.0)
    wdRatingScore: real('wd_rating_score'),

    // ========== Admin Review Fields ==========
    // Admin review status: pending | approved | rejected
    reviewStatus: text('review_status').$type<ReviewStatus>().default('pending'),

    // Rejection reason (per-image, e.g., "NSFW content", "Copyright violation")
    rejectionReason: text('rejection_reason'),

    // Timestamp when admin reviewed this image
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    // Clerk User ID of admin who reviewed this image
    reviewedBy: text('reviewed_by'),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assetIdIdx: index('idx_editor_images_asset_id').on(table.assetId),
    uploadStatusIdx: index('idx_editor_images_upload_status').on(table.uploadStatus),
    createdAtIdx: index('idx_editor_images_created_at').on(table.createdAt.desc()),
    // Tagging indexes
    taggingStatusIdx: index('idx_editor_images_tagging_status').on(table.taggingStatus),
    falconsaiStatusIdx: index('idx_editor_images_falconsai_status').on(table.falconsaiStatus),
    falconsaiIsNsfwIdx: index('idx_editor_images_falconsai_is_nsfw').on(table.falconsaiIsNsfw),
    wdRatingIdx: index('idx_editor_images_wd_rating').on(table.wdRating),
    // Review indexes
    reviewStatusIdx: index('idx_editor_images_review_status').on(table.reviewStatus),
    versionIdIdx: index('idx_editor_images_version_id').on(table.versionId),
    revisionIdIdx: index('idx_editor_images_revision_id').on(table.revisionId),
    // Note: GIN index for tag_ids is created in migration (Drizzle doesn't support GIN directly)
  })
);

export type EditorImage = typeof editorImages.$inferSelect;
export type NewEditorImage = typeof editorImages.$inferInsert;
