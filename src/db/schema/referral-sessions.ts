/**
 * Referral Sessions 테이블 스키마
 * Creator Referral Program - 레퍼럴 세션 추적
 *
 * 크리에이터 링크를 통해 유입된 방문자 세션 관리
 * - 30일 유효기간 (재방문 시 갱신)
 * - 구매 전환 추적
 * - 크리에이터별 독립 세션
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

import { assets } from './assets';
import { users } from './users';

/**
 * Entry page type enum
 */
export const entryPageTypes = ['profile', 'model'] as const;
export type EntryPageType = (typeof entryPageTypes)[number];

export const referralSessions = pgTable(
  'referral_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Creator information
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    creatorUsername: varchar('creator_username', { length: 100 }).notNull(),

    // Visitor identification (confirmed on login, anonymous users tracked via cookie only)
    visitorUserId: text('visitor_user_id').references(() => users.userId, { onDelete: 'set null' }),

    // Entry information
    entryUrl: text('entry_url').notNull(),
    entryPageType: varchar('entry_page_type', { length: 20 }).$type<EntryPageType>().notNull(),
    entryAssetId: text('entry_asset_id').references(() => assets.id, { onDelete: 'set null' }),

    // Session lifecycle
    firstVisitAt: timestamp('first_visit_at', { withTimezone: true }).notNull().defaultNow(),
    lastVisitAt: timestamp('last_visit_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Conversion status
    converted: boolean('converted').default(false),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    conversionPurchaseId: text('conversion_purchase_id'),

    // Statistics
    visitCount: integer('visit_count').default(1),

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    creatorIdx: index('idx_referral_sessions_creator').on(table.creatorId),
    visitorIdx: index('idx_referral_sessions_visitor').on(table.visitorUserId),
    activeIdx: index('idx_referral_sessions_active').on(table.creatorId, table.expiresAt),
    expiresIdx: index('idx_referral_sessions_expires').on(table.expiresAt),
    // Unique active session per creator-visitor pair (handled in migration with partial index)
  })
);

export type ReferralSession = typeof referralSessions.$inferSelect;
export type NewReferralSession = typeof referralSessions.$inferInsert;
