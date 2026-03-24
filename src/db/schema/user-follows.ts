/**
 * User Follows 테이블 스키마
 * 사용자 팔로우 시스템 (CreatorCard 컴포넌트에서 사용)
 *
 * Phase 3 마이그레이션으로 생성됨
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, index, primaryKey, check } from 'drizzle-orm/pg-core';

export const userFollows = pgTable(
  'user_follows',
  {
    // 복합 Primary Key (follower_id, following_id)
    followerId: text('follower_id').notNull(),
    followingId: text('following_id').notNull(),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.followerId, table.followingId] }),
    followerIdx: index('idx_user_follows_follower').on(table.followerId),
    followingIdx: index('idx_user_follows_following').on(table.followingId),
    noSelfFollow: check('no_self_follow', sql`${table.followerId} != ${table.followingId}`),
  })
);

export type UserFollow = typeof userFollows.$inferSelect;
export type NewUserFollow = typeof userFollows.$inferInsert;
