/**
 * Beta Feedback Schema
 * 베타 프로그램 피드백 테이블
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';

import { creatorBenefitPrograms } from './creator-benefit-programs';
import { users } from './users';

export const betaFeedback = pgTable(
  'beta_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 유저 연결
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    benefitProgramId: uuid('benefit_program_id')
      .notNull()
      .references(() => creatorBenefitPrograms.id, { onDelete: 'cascade' }),

    // 피드백 내용
    rating: integer('rating').notNull(), // 1-5 별점
    likes: text('likes').array(), // 좋았던 점 (다중 선택)
    improvements: text('improvements').array(), // 개선점 (다중 선택)
    additionalComments: text('additional_comments'), // 추가 의견

    // 메타
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_beta_feedback_user').on(table.userId),
    index('idx_beta_feedback_program').on(table.benefitProgramId),
    unique('beta_feedback_user_program_unique').on(
      table.userId,
      table.benefitProgramId
    ),
  ]
);

// 피드백 옵션 상수
export const FEEDBACK_LIKES = [
  'fee_savings', // 수수료 절감
  'easy_upload', // 쉬운 업로드
  'good_ui', // 좋은 UI
  'fast_settlement', // 빠른 정산
  'helpful_support', // 도움되는 지원
] as const;

export const FEEDBACK_IMPROVEMENTS = [
  'more_features', // 더 많은 기능
  'better_ui', // UI 개선
  'faster_load', // 로딩 속도
  'more_analytics', // 더 많은 분석
  'better_docs', // 문서 개선
] as const;

// 타입 추출
export type BetaFeedback = typeof betaFeedback.$inferSelect;
export type NewBetaFeedback = typeof betaFeedback.$inferInsert;
