/**
 * Asset Pricing 테이블 스키마
 * 에셋 가격 정보 저장 (1:1 관계)
 */

import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, boolean, decimal, index, unique } from 'drizzle-orm/pg-core';

import { assets } from './assets';

export const assetPricing = pgTable(
  'asset_pricing',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 에셋 참조 (1:1 관계)
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),

    // 가격 정보
    price: decimal('price', { precision: 10, scale: 2 }).notNull().default('0.00'), // USD
    isFree: boolean('is_free').notNull().default(false),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assetIdUnique: unique('idx_asset_pricing_asset_id').on(table.assetId),
    isFreeIdx: index('idx_asset_pricing_is_free').on(table.isFree),
  })
);

export type AssetPricing = typeof assetPricing.$inferSelect;
export type NewAssetPricing = typeof assetPricing.$inferInsert;
