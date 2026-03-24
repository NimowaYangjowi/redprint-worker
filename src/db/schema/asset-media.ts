/**
 * Asset Media 테이블 스키마
 * 에셋 쇼케이스 이미지/비디오 저장
 */

import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  index,
  boolean,
  real,
  jsonb,
} from 'drizzle-orm/pg-core';

import { assetVersions } from './asset-versions';
import { assets } from './assets';
// Note: versionRevisions reference is defined in index.ts to avoid circular dependency

/**
 * 업로드 상태 enum
 * reserved → uploading → completed | failed
 */
export const mediaUploadStatus = ['reserved', 'uploading', 'completed', 'failed'] as const;
export type MediaUploadStatus = (typeof mediaUploadStatus)[number];

/**
 * 태깅 상태 enum
 * pending → processing → completed | failed | skipped
 */
export const taggingStatusValues = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const;
export type TaggingStatus = (typeof taggingStatusValues)[number];

/**
 * 미디어 심사 상태 enum (Admin Review)
 * pending → approved | rejected
 */
export const reviewStatusValues = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof reviewStatusValues)[number];

/**
 * WD Tagger Rating enum
 * Content rating classification
 */
export const wdRatingValues = ['explicit', 'questionable', 'safe'] as const;
export type WdRating = (typeof wdRatingValues)[number];

/**
 * Raw tag data structure from AI detection
 */
export interface RawTagData {
  name: string;
  confidence: number;
  category?: number;
}

/**
 * Keyframe analysis status
 */
export const keyframeStatusValues = ['pending', 'processing', 'completed', 'failed'] as const;
export type KeyframeStatus = (typeof keyframeStatusValues)[number];

/**
 * Artwork generation parameters stored per-media
 * Different fields required based on model type (LoRA vs Workflow)
 */
export interface ArtworkParams {
  // Reference-only flag (skip parameter validation)
  // When true, this media is just a reference image, not an artwork generated with the model
  isReferenceOnly?: boolean;

  // --- Prompt fields ---
  /** Positive prompt for generation (required for non-reference artwork) */
  positivePrompt?: string;
  /** Negative prompt (optional) */
  negativePrompt?: string;
  /** Video prompt for motion/camera control (conditional) */
  videoPrompt?: string;
  /** Video negative prompt (optional) */
  videoNegativePrompt?: string;
  /** Whether this video was generated from an image (img2vid) @default true */
  isVideoFromImage?: boolean;

  // --- Legacy field aliases (backward compatibility) ---
  /** @deprecated Use positivePrompt instead */
  prompt?: string;
  /** @deprecated Use positivePrompt instead - alias for video artwork */
  imagePrompt?: string;
  /** @deprecated Use negativePrompt instead - alias for video artwork */
  imageNegativePrompt?: string;

  // Required for both LoRA and Workflow (unless isReferenceOnly is true)
  sampler?: string;         // e.g., 'euler', 'dpmpp_2m', 'ddim'
  steps?: number;           // Generation steps (1-150)
  cfgScale?: number;        // CFG Scale value (1-30)

  // LoRA-specific (required for LoRA models)
  loraStrength?: number;    // LoRA strength (0-2)

  // Workflow-specific (seller-defined key strengths)
  keyStrengths?: Array<{
    name: string;           // Node/control name
    value: number;          // Strength value
  }>;

  // Workflow-specific (file reference within ZIP bundle)
  workflowFile?: string;    // Path to workflow file used (ZIP-relative or filename)

  // LoRA/LyCORIS-specific (file reference within ZIP bundle)
  usedModelFile?: string;   // Path to model file used (ZIP-relative)

  // Optional for both
  baseModel?: string;       // Can override version's base model
  clipSkip?: number;        // Clip skip value (1-12)
  seed?: number;            // Seed for reproducibility
  scheduler?: string;       // Scheduler type (e.g., 'karras', 'normal')
  resolution?: {            // Auto-extracted from image or manually set
    width: number;
    height: number;
  };

  // Prompt-specific video fields (when assetType === 'Prompt')
  /** @deprecated Use numFrames instead. Kept for backward compatibility. */
  frameCount?: number;      // Frame count for video generation (deprecated)
  numFrames?: number;       // Number of frames (unified with WorkflowFormData)
  fps?: number;             // FPS setting for video generation
  motionBucketId?: number;  // SVD motion control (1-255)
  motionScale?: number;     // Motion intensity multiplier
  augmentationLevel?: number; // Augmentation / Noise Level (0-1)

  // User-defined custom parameters
  customFields?: Array<{
    id: string;
    key: string;
    value: string | number;
  }>;
}

/**
 * Keyframe analysis result for video multi-frame processing
 *
 * Each video can have 3-10 keyframes extracted and analyzed independently.
 * Results are aggregated: NSFW uses OR logic, tags are merged with deduplication.
 */
export interface KeyframeAnalysis {
  /** Frame index (0-based) */
  index: number;
  /** Timestamp in seconds */
  timestamp: number;
  /** R2 storage key */
  r2Key: string;
  /** R2 public URL */
  r2Url: string;
  /** NSFW detection result */
  falconsaiIsNsfw: boolean;
  /** NSFW confidence score (0-1) */
  falconsaiNsfwScore: number;
  /** Extracted tags from this frame */
  tags: RawTagData[];
  /** Content rating: explicit | questionable | safe */
  wdRating?: WdRating;
  /** Rating confidence score (0-1) */
  wdRatingScore?: number;
  /** Skin tone ratio from extraction (0-1) */
  skinScore?: number;
  /** Processing status for this frame */
  status: KeyframeStatus;
  /** Error message if processing failed */
  error?: string;
}

export const assetMedia = pgTable(
  'asset_media',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 에셋 참조
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),

    // 버전 참조 (optional - null이면 모든 버전에 표시)
    versionId: text('version_id')
      .references(() => assetVersions.id, { onDelete: 'set null' }),

    // 리비전 참조 (for draft/published separation)
    // Note: FK constraint defined in DB migration (circular dependency with version-revisions)
    revisionId: text('revision_id'),

    // 업로드 세션 참조 (보상 트랜잭션용)
    sessionId: text('session_id'),

    // 미디어 정보
    mediaType: text('media_type').notNull(), // 'image' | 'video'
    fileName: text('file_name').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(), // bytes

    // R2 스토리지 정보
    r2Key: text('r2_key').notNull(),
    r2Url: text('r2_url').notNull(),

    // 업로드 상태 (Saga Pattern용)
    uploadStatus: text('upload_status').default('completed'),

    // 썸네일 (이미지 최적화, 비디오 중간 프레임)
    thumbnailUrl: text('thumbnail_url'),

    // 순서 (갤러리 정렬)
    displayOrder: integer('display_order').default(0),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // Falconsai NSFW detection fields
    falconsaiIsNsfw: boolean('falconsai_is_nsfw'),
    falconsaiNsfwScore: real('falconsai_nsfw_score'),
    falconsaiStatus: text('falconsai_status').default('pending'),

    // Manual review fields (for video/unsupported media)
    requiresManualReview: boolean('requires_manual_review').default(false),
    manualReviewReason: text('manual_review_reason'),

    // ========== Media-level Tagging Fields ==========
    // Array of danbooru_tags.id for efficient search
    tagIds: text('tag_ids')
      .array()
      .default(sql`'{}'::text[]`),

    // Raw tag data from AI detection
    tags: jsonb('tags').$type<RawTagData[]>().default([]),

    // AI-generated caption/description
    caption: text('caption'),

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

    // ========== Video Keyframe Analysis Fields ==========
    // Array of keyframe analysis results for videos
    // Each element contains per-frame NSFW/tagging results
    keyframes: jsonb('keyframes').$type<KeyframeAnalysis[]>().default([]),

    // Number of extracted keyframes (0 for images, 3-10 for videos)
    keyframeCount: integer('keyframe_count').default(0),

    // Maximum NSFW score across all keyframes (for sorting/filtering)
    maxNsfwScore: real('max_nsfw_score'),

    // ========== Admin Review Fields ==========
    // Admin review status: pending | approved | rejected
    reviewStatus: text('review_status').$type<ReviewStatus>().default('pending'),

    // Rejection reason (per-media, e.g., "NSFW content", "Copyright violation")
    rejectionReason: text('rejection_reason'),

    // Timestamp when admin reviewed this media
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    // Clerk User ID of admin who reviewed this media
    reviewedBy: text('reviewed_by'),

    // ========== Artwork Generation Parameters ==========
    // Per-media generation parameters (sampler, steps, CFG, strength, etc.)
    // Stored as JSONB to accommodate different parameter sets for LoRA vs Workflow
    artworkParams: jsonb('artwork_params').$type<ArtworkParams>(),

    // ========== Clone Tracking ==========
    /** 복제 원본 미디어 ID (R2 파일 공유 추적, 삭제 방어용) */
    sourceMediaId: text('source_media_id'),

    // ========== Prompt Marketplace Fields (2026-02-23 pivot) ==========
    /** Whether this media is an example output (vs. generic showcase) */
    isExampleOutput: boolean('is_example_output').default(false),
    /** Parameter values snapshot when this example was generated */
    parameterSnapshot: jsonb('parameter_snapshot').$type<Record<string, string | number>>(),

    // ========== Transcode Pipeline Fields ==========
    /** Transcode status: null (no transcoding) / pending / processing / completed / failed */
    transcodeStatus: text('transcode_status'),

    // ========== Tagging Backfill Tracking Fields (Phase 2B, 2C) ==========
    /** Unified retry counter across job-level retries and backfill scans; prevents infinite loops */
    taggingRetryCount: integer('tagging_retry_count').default(0),
    /** Cooldown anchor for retry backoff; set on each tagging attempt */
    lastTaggingAttemptAt: timestamp('last_tagging_attempt_at', { withTimezone: true }),
  },
  (table) => ({
    assetIdIdx: index('idx_asset_media_asset_id').on(table.assetId),
    versionIdIdx: index('idx_asset_media_version_id').on(table.versionId),
    revisionIdIdx: index('idx_asset_media_revision_id').on(table.revisionId),
    mediaTypeIdx: index('idx_asset_media_media_type').on(table.mediaType),
    displayOrderIdx: index('idx_asset_media_display_order').on(table.displayOrder),
    sessionIdIdx: index('idx_asset_media_session_id').on(table.sessionId),
    uploadStatusIdx: index('idx_asset_media_upload_status').on(table.uploadStatus),
    // Falconsai NSFW indexes
    falconsaiIsNsfwIdx: index('idx_asset_media_falconsai_is_nsfw').on(table.falconsaiIsNsfw),
    falconsaiStatusIdx: index('idx_asset_media_falconsai_status').on(table.falconsaiStatus),
    // Tagging indexes
    taggingStatusIdx: index('idx_asset_media_tagging_status').on(table.taggingStatus),
    wdRatingIdx: index('idx_asset_media_wd_rating').on(table.wdRating),
    // Admin review indexes
    reviewStatusIdx: index('idx_asset_media_review_status').on(table.reviewStatus),
    transcodeStatusIdx: index('idx_asset_media_transcode_status').on(table.transcodeStatus),
    // Note: GIN index for tag_ids is created in migration (Drizzle doesn't support GIN directly)
    // Note: Partial indexes for review_status are created in migration
  })
);

export type AssetMedia = typeof assetMedia.$inferSelect;
export type NewAssetMedia = typeof assetMedia.$inferInsert;
