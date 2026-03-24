/**
 * Asset Reviews 테이블 스키마
 * 에셋 리뷰 시스템 (ReviewSection 컴포넌트에서 사용)
 *
 * Phase 2 마이그레이션으로 생성됨
 */

import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, integer, boolean, index, check } from 'drizzle-orm/pg-core';

export const assetReviews = pgTable(
  'asset_reviews',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 관계
    assetId: text('asset_id').notNull(),
    userId: text('user_id').notNull(),

    // 리뷰 내용
    rating: integer('rating').notNull(), // 1-5
    title: text('title'),
    content: text('content').notNull(),

    // 메타 정보
    isVerifiedPurchase: boolean('is_verified_purchase').default(false),
    helpfulCount: integer('helpful_count').default(0),

    // 크리에이터 답변
    creatorReply: text('creator_reply'),
    creatorReplyAt: timestamp('creator_reply_at', { withTimezone: true }),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    assetIdIdx: index('idx_asset_reviews_asset_id').on(table.assetId),
    userIdIdx: index('idx_asset_reviews_user_id').on(table.userId),
    ratingIdx: index('idx_asset_reviews_rating').on(table.rating),
    createdAtIdx: index('idx_asset_reviews_created_at').on(table.createdAt.desc()),
    ratingCheck: check('rating_check', sql`${table.rating} BETWEEN 1 AND 5`),
  })
);

export type AssetReview = typeof assetReviews.$inferSelect;
export type NewAssetReview = typeof assetReviews.$inferInsert;
