/**
 * Users 테이블 스키마
 * Clerk 인증과 연동되는 사용자 정보
 *
 * display_name: 사용자 표시 이름 (유니크, 필수)
 * - 가입 시 랜덤 생성 ("Adjective Animal")
 * - 사용자가 직접 변경 가능
 *
 * Creator Referral Program:
 * - completed_sales_count, referral_sales_count (캐시)
 * - referral_code, referral_enabled (설정)
 *
 * Email Verification:
 * - email_verified: Clerk에서 동기화된 이메일 인증 상태
 * - email_verified_at: 이메일 인증 완료 시간 (UTC)
 *
 * NOTE: Stripe Connect 데이터는 user_stripe_accounts 테이블로 분리됨 (2026-01-17)
 * @see src/db/schema/user-stripe-accounts.ts
 */

import { pgTable, text, timestamp, jsonb, index, uniqueIndex, integer, boolean, varchar } from 'drizzle-orm/pg-core';

/**
 * 소셜 링크 타입
 */
export type SocialLinks = {
  twitter?: string;
  instagram?: string;
  threads?: string;
  youtube?: string;
  github?: string;
  huggingface?: string;
  website?: string;
};

export const users = pgTable(
  'users',
  {
    // Clerk User ID (Primary Key)
    userId: text('user_id').primaryKey(),

    // 기본 정보
    email: text('email'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),

    // Email Verification
    // Clerk webhook에서 동기화되는 이메일 인증 상태
    emailVerified: boolean('email_verified').default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),

    // 프로필 확장 필드
    bio: text('bio'),

    // Phase 3 확장 필드 (CreatorCard에서 사용)
    socialLinks: jsonb('social_links').$type<SocialLinks>().default({}),

    // Profile Page Integration
    coverImageUrl: text('cover_image_url'),

    // 역할 및 상태
    role: text('role').notNull().default('user'),

    // Creator Referral Program - 크리에이터 통계 (캐시)
    completedSalesCount: integer('completed_sales_count').default(0),
    referralSalesCount: integer('referral_sales_count').default(0),

    // Creator Referral Program - 레퍼럴 설정
    referralCode: varchar('referral_code', { length: 100 }),
    referralEnabled: boolean('referral_enabled').default(true),

    // NOTE: Stripe fields removed - see user_stripe_accounts table

    // Phase 2: Settlement Dualization - 크리에이터 정산 선호 방식
    // 'stripe' | 'sphere' | null (null = 기본값 Stripe)
    payoutPreference: varchar('payout_preference', { length: 20 }),

    // Escrow Settlement Model - 정산 스케줄 설정
    payoutDay: integer('payout_day').default(15),
    payoutTimezone: varchar('payout_timezone', { length: 64 }).notNull().default('UTC'),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    lastLogin: timestamp('last_login', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),

    // Soft delete 및 활동 추적
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    lastActive: timestamp('last_active', { withTimezone: true }),
  },
  (table) => ({
    displayNameIdx: uniqueIndex('idx_users_display_name').on(table.displayName),
    emailIdx: index('idx_users_email').on(table.email),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// NOTE: StripeConnectStatus type moved to user-stripe-accounts.ts
