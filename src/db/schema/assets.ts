/**
 * Assets 테이블 스키마
 * AI Workflow, LoRA, LyCORIS, Checkpoint, Prompt 에셋의 기본 정보 저장
 */

import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, index, integer, boolean } from 'drizzle-orm/pg-core';

import type { ParameterTemplate, TargetModel, VersionCompat } from '@/lib/types/prompt-marketplace';
import type { PromptTemplate } from '@/lib/validation/asset-contracts';

/**
 * 에셋 상태 enum
 * Status flow: unpublished → submitted → processing → pending_review → published | rejected | failed | archived
 *
 * - unpublished: 작업 중, 필수 필드 미완성 가능 (사용자가 생각하는 "미공개")
 * - submitted: 제출됨, 처리 대기
 * - processing: 태깅잡이 진행 중
 * - pending_review: 태깅 완료, Admin 심사 대기 중
 * - published: Admin 승인됨
 * - rejected: Admin 거부됨 (사용자가 수정 후 재제출 가능)
 * - failed: 처리 실패
 * - archived: 보관됨
 *
 * ⚠️ DEPRECATED STATUS - 'uploading':
 * - Asset-level 'uploading' is deprecated as of 2026-01
 * - New code uses 'unpublished' (see src/lib/upload/saga/draft-creator.ts)
 * - Kept in enum for backward compatibility with existing data in production
 * - Note: File-level (asset_files.uploadStatus) and session-level 'uploading' are still actively used
 * - Do NOT use 'uploading' for new asset/version records
 */
export const assetStatusValues = [
  'unpublished',  // Work in progress (user editing)
  'submitted',    // Ready for processing
  'uploading',    // ⚠️ DEPRECATED - kept for backward compatibility only. Use 'unpublished' instead.
  'processing',
  'pending_review',
  'published',
  'rejected',
  'failed',
  'archived',
] as const;
export type AssetStatus = (typeof assetStatusValues)[number];

/**
 * 허용되는 에셋 상태 전이
 * Status flows:
 *   - Normal: unpublished → submitted/processing → pending_review → published | rejected
 *   - Resubmit: rejected → processing/pending_review → published | rejected
 *   - Direct: unpublished/rejected → processing (when tagging needed)
 *   - Direct: unpublished/rejected → pending_review (when no tagging needed)
 *
 * Note: 'submitted' is an optional intermediate state. Tagging flow can bypass it.
 */
export const ALLOWED_ASSET_STATUS_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  unpublished: ['submitted', 'processing', 'pending_review'], // Submit → processing or direct to pending_review
  submitted: ['processing', 'pending_review', 'unpublished'], // Processing, direct review, or back to editing
  uploading: ['processing', 'unpublished'],            // Deprecated but handle gracefully
  processing: ['pending_review', 'failed', 'unpublished'], // Complete, fail, or cancel
  pending_review: ['published', 'rejected'],           // Admin decision
  published: ['archived', 'pending_review'],           // Archive or new version review
  rejected: ['unpublished', 'submitted', 'processing', 'pending_review'], // Resubmit paths
  failed: ['unpublished'],                             // Recovery
  archived: [],                                        // Terminal state
};

export const assets = pgTable(
  'assets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 작성자 정보
    userId: text('user_id').notNull(),

    // 기본 정보
    assetName: text('asset_name').notNull(), // 에셋 이름 - 식별자 및 표시 타이틀 역할
    assetType: text('asset_type').notNull(), // 'Prompt' (narrowed from multi-type in v1)
    // Note: title 컬럼 제거됨 - assetName이 타이틀 역할을 함
    // Note: description은 asset_versions 테이블에서 버전별로 관리됨
    category: text('category').notNull(),
    tags: jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`),

    // 라이선싱 & 권한
    permissions: jsonb('permissions')
      .$type<{
        useWithoutCredit: boolean;
        shareMerges: boolean;
        differentPermissionsOnMerges: boolean;
      }>()
      .notNull(),

    commercialUse: jsonb('commercial_use')
      .$type<{
        sellGeneratedImages: boolean;
        useOnGenerationServices: boolean;
        sellModelOrMerges: boolean;
      }>()
      .notNull(),

    // 콘텐츠 제한
    contentRestrictions: jsonb('content_restrictions')
      .$type<{
        depictsActualPerson: 'Yes' | 'No';
        /** 실제 인물 초상권 사용 권한 보유 확인 */
        hasLegalRightToLikeness?: boolean;
        /** 법적 책임 수락 확인 */
        acceptsLegalResponsibility?: boolean;
        intendedForMatureThemes: boolean;
        intendedForMinorCharacter: boolean;
        cannotBeUsedForNSFW: boolean;
      }>()
      .notNull(),

    // 상태
    // 'unpublished' | 'uploading' | 'pending_review' | 'published' | 'rejected' | 'failed' | 'archived'
    // Note: 'uploading' is deprecated, 'unpublished' is the new default
    status: text('status').$type<AssetStatus>().notNull().default('unpublished'),

    // NSFW aggregation flag (auto-updated by DB trigger)
    isNsfw: boolean('is_nsfw').default(false),

    // Admin-only visibility flag
    // When true, this asset is only visible to admin users (not shown in explore/profile feeds)
    // Used for admin testing: submit through the full review pipeline without exposing to regular users
    isAdminOnly: boolean('is_admin_only').default(false).notNull(),

    // 통계 (Phase 1 마이그레이션 반영)
    viewCount: integer('view_count').default(0),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    // Soft delete 타임스탬프 (NULL = active, NOT NULL = deleted)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // ========== Admin Approval Fields ==========
    // Summary reason for asset rejection (e.g., "Some media were rejected")
    rejectionReason: text('rejection_reason'),

    // Timestamp when asset was rejected by admin
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),

    // Clerk User ID of admin who rejected the asset
    rejectedBy: text('rejected_by'),

    // Timestamp when asset was approved by admin
    approvedAt: timestamp('approved_at', { withTimezone: true }),

    // Clerk User ID of admin who approved the asset
    approvedBy: text('approved_by'),

    // ========== Prompt Asset Fields (2026-02-05) ==========
    // Only used when assetType === 'Prompt'

    // Generation types array (unified for all asset types)
    // Added in Phase 3: Upload Flow Unification (2026-02-07)
    generationTypes: text('generation_types')
      .array()
      .default(sql`ARRAY['image']::text[]`),

    /** Prompt mode: 'prompt-only' (text only) | 'workflow' (node pipeline) */
    promptMode: text('prompt_mode').$type<'prompt-only' | 'workflow'>(),
    /** Prompt template with variable placeholders (for paid prompts) */
    promptTemplate: jsonb('prompt_template').$type<PromptTemplate>(),

    // ========== Prompt Marketplace Fields (2026-02-23 pivot) ==========
    /** Main prompt text body (supports {variable} syntax) */
    promptText: text('prompt_text'),
    /** LLM system prompt (optional) */
    systemPrompt: text('system_prompt'),
    /** Parameter template with variable definitions (new format with typed variables) */
    newParameterTemplate: jsonb('parameter_template_v2').$type<ParameterTemplate>(),
    /** Rich-text customization guide for buyers */
    customizationGuide: text('customization_guide'),
    /** Compatible AI models list */
    targetModels: jsonb('target_models').$type<TargetModel[]>(),
    /** Model version compatibility matrix */
    modelVersionCompat: jsonb('model_version_compat').$type<VersionCompat>(),
    /** Visual style (11 options from category taxonomy) */
    style: text('style'),

    // ========== Generation Service Fields (2026-02-05: t2i2v feature) ==========
    /** Image generation service used (for 'image' and 'text-to-image-to-video' subtypes) */
    imageGenerationService: text('image_generation_service'),
    /** Custom image service name when 'other' is selected */
    imageGenerationServiceOther: text('image_generation_service_other'),
    /** Video generation service used (for video-related subtypes) */
    videoGenerationService: text('video_generation_service'),
    /** Custom video service name when 'other' is selected */
    videoGenerationServiceOther: text('video_generation_service_other'),

    // ========== Generic Metadata Field (2026-02-06) ==========
    /** Generic metadata JSON field for extensible data storage (e.g., workflowNodeMapping) */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    userIdIdx: index('idx_assets_user_id').on(table.userId),
    categoryIdx: index('idx_assets_category').on(table.category),
    assetTypeIdx: index('idx_assets_asset_type').on(table.assetType),
    statusIdx: index('idx_assets_status').on(table.status),
    createdAtIdx: index('idx_assets_created_at').on(table.createdAt.desc()),
    // NSFW index for filtering
    isNsfwIdx: index('idx_assets_is_nsfw').on(table.isNsfw),
    // Admin-only index for efficient filtering
    isAdminOnlyIdx: index('idx_assets_is_admin_only').on(table.isAdminOnly),
    // Prompt asset indexes (only for assetType === 'Prompt')
    promptModeIdx: index('idx_assets_prompt_mode').on(table.promptMode),
    // Generation service indexes for filtering/search
    imageGenServiceIdx: index('idx_assets_image_gen_service').on(table.imageGenerationService),
    videoGenServiceIdx: index('idx_assets_video_gen_service').on(table.videoGenerationService),
    // Prompt marketplace indexes
    styleIdx: index('idx_assets_style').on(table.style),
    // Generation types GIN index for array querying (Phase 3: Upload Flow Unification)
    // Note: GIN index is created in SQL migration, not here (Drizzle doesn't support GIN directly)
  })
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

/**
 * 에셋 상태 전이가 유효한지 확인
 */
export function isValidAssetStatusTransition(
  currentStatus: AssetStatus,
  newStatus: AssetStatus
): boolean {
  return ALLOWED_ASSET_STATUS_TRANSITIONS[currentStatus].includes(newStatus);
}

/**
 * 상태별 설명 (UI 표시용)
 */
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  unpublished: '수정 중',
  submitted: '제출됨',
  uploading: '업로드 중', // ⚠️ DEPRECATED - kept for backward compatibility
  processing: '처리 중',
  pending_review: '심사 대기',
  published: '공개됨',
  rejected: '심사 거절',
  failed: '처리 실패',
  archived: '보관됨',
};
