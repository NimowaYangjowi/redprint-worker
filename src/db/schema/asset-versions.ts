/**
 * Asset Versions 테이블 스키마
 * 에셋 버전별 정보 및 설정 저장
 */

import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, index, unique } from 'drizzle-orm/pg-core';

import { assets } from './assets';
// Note: versionRevisions reference is defined in index.ts to avoid circular dependency

export const assetVersions = pgTable(
  'asset_versions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 에셋 참조
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),

    // 버전 정보
    versionName: text('version_name').notNull(),
    description: text('description'),
    /** Usage Guide (TipTap HTML) - 구매자용 사용 가이드 */
    usageGuide: text('usage_guide'),

    // 생성 유형 (image, video)
    generationTypes: text('generation_types')
      .array()
      .$type<('image' | 'video')[]>()
      .default(['image']),

    // Note: LoRA-specific fields removed in prompt marketplace pivot (2026-02-23):
    // triggerWords, noTriggerWords, trainingParams, baseModel, recommendedSettings, videoRecommendedSettings

    // 상태 (All states: unpublished, processing, pending_review, published, rejected, failed, archived)
    // Note: 'uploading' is deprecated - use 'unpublished' for new versions
    status: text('status').notNull().default('unpublished'),

    // 버전별 대표 아트워크 (null이면 displayOrder=0 미디어 사용)
    // Note: FK constraint defined in DB migration (circular dependency with asset-media)
    primaryMediaId: text('primary_media_id'),

    // ========== Revision System Fields ==========
    // Currently published revision (visible to users)
    // Note: FK constraint defined in DB migration (circular dependency with version-revisions)
    publishedRevisionId: text('published_revision_id'),

    // Revision being edited (only visible to owner)
    // Note: FK constraint defined in DB migration (circular dependency with version-revisions)
    // Renamed from draftRevisionId → editingRevisionId (2026-01-16)
    editingRevisionId: text('editing_revision_id'),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assetIdIdx: index('idx_asset_versions_asset_id').on(table.assetId),
    createdAtIdx: index('idx_asset_versions_created_at').on(table.createdAt.desc()),
    uniqueAssetVersion: unique('idx_asset_versions_unique').on(table.assetId, table.versionName),
  })
);

export type AssetVersion = typeof assetVersions.$inferSelect;
export type NewAssetVersion = typeof assetVersions.$inferInsert;
