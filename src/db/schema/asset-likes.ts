/**
 * Asset Likes 테이블 스키마
 * 에셋 좋아요 시스템 (StatsBar 컴포넌트에서 사용)
 *
 * Phase 2 마이그레이션으로 생성됨
 */

import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, index, unique } from 'drizzle-orm/pg-core';

export const assetLikes = pgTable(
  'asset_likes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 관계 (UNIQUE 제약으로 한 사용자가 하나의 에셋에 한 번만 좋아요 가능)
    assetId: text('asset_id').notNull(),
    userId: text('user_id').notNull(),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    assetIdIdx: index('idx_asset_likes_asset_id').on(table.assetId),
    userIdIdx: index('idx_asset_likes_user_id').on(table.userId),
    uniqueUserAsset: unique('unique_asset_user_like').on(table.assetId, table.userId),
  })
);

export type AssetLike = typeof assetLikes.$inferSelect;
export type NewAssetLike = typeof assetLikes.$inferInsert;
