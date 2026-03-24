/**
 * Creator Benefit Programs Schema
 * 크리에이터 혜택 프로그램 (베타, 우수 크리에이터 등) 관리 테이블
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  decimal,
  index,
  unique,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export const creatorBenefitPrograms = pgTable(
  'creator_benefit_programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 유저 연결
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    // 프로그램 식별
    programType: text('program_type').notNull(),
    invitationCode: text('invitation_code'),

    // 혜택 내용
    feeExempt: boolean('fee_exempt').notNull().default(true),
    feeRateOverride: decimal('fee_rate_override', { precision: 4, scale: 3 }),

    // 기간
    enrolledAt: timestamp('enrolled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    firstUploadAt: timestamp('first_upload_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // 피드백
    feedbackSubmittedAt: timestamp('feedback_submitted_at', {
      withTimezone: true,
    }),

    // 상태
    isActive: boolean('is_active').notNull().default(true),

    // 메타
    createdBy: text('created_by'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_benefit_programs_user_active')
      .on(table.userId, table.isActive)
      .where(sql`${table.isActive} = true`),
    index('idx_benefit_programs_program_type').on(table.programType),
    index('idx_benefit_programs_expires')
      .on(table.expiresAt)
      .where(sql`${table.isActive} = true AND ${table.expiresAt} IS NOT NULL`),
    unique('benefit_programs_user_program_unique').on(
      table.userId,
      table.programType
    ),
  ]
);

// 프로그램 타입 상수
export const PROGRAM_TYPES = {
  BETA_2024: 'beta_2024',
  TOP_CREATOR: 'top_creator',
} as const;

export type ProgramType = (typeof PROGRAM_TYPES)[keyof typeof PROGRAM_TYPES];

// 타입 추출
export type CreatorBenefitProgram = typeof creatorBenefitPrograms.$inferSelect;
export type NewCreatorBenefitProgram =
  typeof creatorBenefitPrograms.$inferInsert;
