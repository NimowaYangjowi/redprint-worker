/**
 * Beta Invitations Schema
 * 베타 프로그램 초대 코드 관리 테이블
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const betaInvitations = pgTable(
  'beta_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 코드
    invitationCode: text('invitation_code').notNull().unique(),

    // 사용 제한
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // 대상 제한 (선택)
    targetEmail: text('target_email'),

    // 상태
    isActive: boolean('is_active').notNull().default(true),

    // 메타
    createdBy: text('created_by').notNull(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_beta_invitations_code_active')
      .on(table.invitationCode)
      .where(sql`${table.isActive} = true`),
    index('idx_beta_invitations_created_by').on(table.createdBy),
  ]
);

// 타입 추출
export type BetaInvitation = typeof betaInvitations.$inferSelect;
export type NewBetaInvitation = typeof betaInvitations.$inferInsert;
