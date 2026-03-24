/**
 * User Stripe Accounts 테이블 스키마
 * Stripe Connect 계정 정보를 별도 테이블로 분리
 *
 * Benefits:
 * - 적절한 3NF 정규화
 * - 1:N 관계로 연결 히스토리 지원
 * - 연결/해제 플로우 지원
 * - 관심사 분리 (SRP)
 *
 * @see plans/2026-01-17_stripe-account-separation/00-overview.md
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Stripe Connect 상태
 * - active: 현재 활성화된 연결
 * - disconnected: 사용자가 연결 해제
 * - suspended: 플랫폼에서 일시 중지
 */
export const stripeAccountStatuses = ['active', 'disconnected', 'suspended'] as const;
export type StripeAccountStatus = (typeof stripeAccountStatuses)[number];

/**
 * 연결 해제 사유
 */
export const disconnectReasons = [
  'user_initiated',      // 사용자가 직접 해제
  'platform_revoked',    // 플랫폼에서 취소
  'stripe_webhook',      // Stripe에서 deauthorized 웹훅
  'account_deleted',     // Stripe 계정 삭제
] as const;
export type DisconnectReason = (typeof disconnectReasons)[number];

export const userStripeAccounts = pgTable(
  'user_stripe_accounts',
  {
    // Primary Key
    id: uuid('id').primaryKey().defaultRandom(),

    // Foreign Key to users
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    // Stripe Account Identifier
    stripeAccountId: text('stripe_account_id').notNull(),

    // Connection Status
    status: text('status')
      .$type<StripeAccountStatus>()
      .notNull()
      .default('active'),

    // Stripe Capability Flags
    onboardingComplete: boolean('onboarding_complete').notNull().default(false),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),

    // Account Details (from Stripe API)
    accountEmail: text('account_email'),
    country: text('country'),
    defaultCurrency: text('default_currency'),
    businessType: text('business_type'), // 'individual' | 'company'

    // Disconnect Information
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    disconnectReason: text('disconnect_reason').$type<DisconnectReason>(),

    // Timestamps
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Index for user lookup
    userIdx: index('idx_usa_user_id').on(table.userId),

    // Index for Stripe account lookup (webhook handling)
    stripeAccountIdx: index('idx_usa_stripe_account_id').on(table.stripeAccountId),

    // Index for status filtering
    statusIdx: index('idx_usa_status').on(table.status),

    // Partial unique index: only one active account per user
    activeUniqueIdx: uniqueIndex('idx_usa_user_active_unique')
      .on(table.userId)
      .where(sql`status = 'active'`),
  })
);

// Inferred Types
export type UserStripeAccount = typeof userStripeAccounts.$inferSelect;
export type NewUserStripeAccount = typeof userStripeAccounts.$inferInsert;

/**
 * Active Stripe Account for API responses
 */
export interface ActiveStripeAccount {
  id: string;
  stripeAccountId: string;
  onboardingComplete: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  accountEmail: string | null;
  country: string | null;
  defaultCurrency: string | null;
  connectedAt: Date;
}

/**
 * Stripe Connection History Entry
 */
export interface StripeConnectionHistoryEntry {
  id: string;
  stripeAccountId: string;
  status: StripeAccountStatus;
  connectedAt: Date;
  disconnectedAt: Date | null;
  disconnectReason: DisconnectReason | null;
}

/**
 * Helper type for checking Stripe status
 */
export interface StripeConnectStatusCheck {
  isConnected: boolean;
  canReceivePayments: boolean;
  canReceivePayouts: boolean;
  needsOnboarding: boolean;
  activeAccount: ActiveStripeAccount | null;
}
