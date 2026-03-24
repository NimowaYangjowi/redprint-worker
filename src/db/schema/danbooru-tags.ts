/**
 * Danbooru 태그 캐시 테이블 스키마
 * 태그 자동완성 및 드롭다운 기능 지원
 *
 * Reference: plans/2025-11-29_danbooru-tags-caching.md
 *
 * 카테고리:
 * - 0: general (일반 태그)
 * - 1: artist (아티스트)
 * - 3: copyright (작품/시리즈)
 * - 4: character (캐릭터)
 * - 5: meta (메타 태그)
 */

import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core';

export const danbooruTags = pgTable(
  'danbooru_tags',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Danbooru 원본 데이터
    danbooruId: integer('danbooru_id').notNull().unique(),
    name: text('name').notNull(),
    category: integer('category').notNull().default(0),
    postCount: integer('post_count').notNull().default(0),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index('idx_danbooru_tags_name').on(table.name),
    categoryIdx: index('idx_danbooru_tags_category').on(table.category),
    postCountIdx: index('idx_danbooru_tags_post_count').on(table.postCount.desc()),
    danbooruIdIdx: index('idx_danbooru_tags_danbooru_id').on(table.danbooruId),
  })
);

export type DanbooruTag = typeof danbooruTags.$inferSelect;
export type NewDanbooruTag = typeof danbooruTags.$inferInsert;
