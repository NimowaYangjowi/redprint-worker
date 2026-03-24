/**
 * Purchases 테이블 스키마
 * 사용자의 모델 구매 내역 및 결제 정보 저장
 *
 * Creator Referral Program:
 * - referral_session_id (레퍼럴 세션 참조)
 * - platform_fee_rate, platform_fee_amount (수수료 기록)
 * - creator_earning_amount, fee_calculation_reason (정산 정보)
 *
 * Stripe Connect Marketplace:
 * - stripe_transfer_id: Stripe Transfer ID (tr_xxx)
 * - transfer_status: 정산 상태
 *   - pending: 정산 대기
 *   - pending_creator_setup: 크리에이터 미연동으로 보류 (Deferred Settlement)
 *   - completed: 정산 완료
 *   - failed: 정산 실패
 *   - cancelled: 환불로 인한 취소
 *
 * @see plans/2026-01-03_deferred-settlement/01-phase0-data-model.md
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  text,
  timestamp,
  decimal,
  varchar,
  integer,
  index,
  uuid,
} from 'drizzle-orm/pg-core';

import { assets } from './assets';
import { referralSessions } from './referral-sessions';
import { users } from './users';

/**
 * 구매 상태 enum
 * in_cart: 장바구니에 담김
 * completed: 결제 완료
 * cancelled: 결제 미완료로 취소됨 (세션 만료/사용자 취소 등)
 * refunded: 환불 완료
 * disputed: 분쟁 중
 */
export const purchaseStatus = ['in_cart', 'checkout_pending', 'completed', 'cancelled', 'refunded', 'partially_refunded', 'disputed'] as const;
export type PurchaseStatus = (typeof purchaseStatus)[number];

/**
 * 결제 상태 enum
 * pending: 결제 대기
 * completed: 결제 완료
 * failed: 결제 실패
 * refunded: 환불 완료
 */
export const paymentStatus = ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'] as const;
export type PaymentStatus = (typeof paymentStatus)[number];

/**
 * 수수료 계산 이유 enum (Creator Referral Program + Beta Program)
 * standard: 일반 유입 (10%)
 * referral_zero_fee: 레퍼럴 유입 (0%)
 * beta_exempt: 베타 프로그램 면제 (0%)
 */
export const feeCalculationReasons = ['standard', 'referral_zero_fee', 'beta_exempt'] as const;
export type FeeCalculationReason = (typeof feeCalculationReasons)[number];

/**
 * Transfer 상태 enum (Stripe Connect Marketplace + Deferred Settlement + Escrow)
 *
 * in_escrow: 에스크로 보류 중 (7일 홀드 기간)
 * pending: 정산 대기 (connected creator, ready to transfer)
 * pending_creator_setup: 크리에이터 미연동으로 보류 (deferred settlement)
 * completed: 정산 완료
 * failed: 정산 실패
 * cancelled: 정산 취소 (환불 처리됨)
 */
export const transferStatuses = [
  'in_escrow',    // NEW - purchase is in 7-day escrow hold
  'pending',
  'pending_creator_setup',
  'completed',
  'failed',
  'cancelled',
  'reversed',
] as const;
export type TransferStatus = (typeof transferStatuses)[number];

// Legacy alias for backward compatibility
export const transferStatus = transferStatuses;

export const purchases = pgTable(
  'purchases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 관계
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),

    // 결제 정보 (구매 시점 스냅샷)
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),

    // 외부 결제 시스템 연동
    paymentProvider: varchar('payment_provider', { length: 50 }), // 'stripe', 'paddle' 등
    paymentIntentId: text('payment_intent_id'), // Stripe PaymentIntent ID
    stripeCheckoutSessionId: text('stripe_checkout_session_id'), // Stripe Checkout Session ID (cs_xxx) for dedup
    paymentStatus: varchar('payment_status', { length: 50 }).notNull().default('completed'),

    // 구매 상태
    status: varchar('status', { length: 20 }).notNull().default('completed'),
    // 취소 사유 (status='cancelled'일 때 주로 사용)
    cancelReason: varchar('cancel_reason', { length: 50 }),

    // 다운로드 추적
    downloadCount: integer('download_count').default(0),
    lastDownloadAt: timestamp('last_download_at', { withTimezone: true }),

    // Creator Referral Program - 레퍼럴 추적
    referralSessionId: uuid('referral_session_id').references(() => referralSessions.id, { onDelete: 'set null' }),

    // Creator Referral Program - 수수료 기록 (정산 증빙용)
    platformFeeRate: decimal('platform_fee_rate', { precision: 5, scale: 4 }),  // 0.0000 ~ 1.0000
    platformFeeAmount: integer('platform_fee_amount'),  // cents
    creatorEarningAmount: integer('creator_earning_amount'),  // cents
    feeCalculationReason: varchar('fee_calculation_reason', { length: 50 }),
    // 'standard' | 'referral_zero_fee'

    // Stripe Connect Marketplace - Transfer 추적
    stripeTransferId: text('stripe_transfer_id'),  // tr_xxx
    transferStatus: varchar('transfer_status', { length: 20 }).default('pending'),

    // Phase 2: Settlement Dualization - 정산 시 사용된 제공자 기록
    // 'stripe' | 'sphere' | null (null = 아직 정산되지 않음)
    settlementMethod: varchar('settlement_method', { length: 20 }),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    escrowReleaseAt: timestamp('escrow_release_at', { withTimezone: true }),
    checkoutPendingAt: timestamp('checkout_pending_at', { withTimezone: true }),
  },
  (table) => ({
    // 복합 인덱스: 중복 체크 쿼리 최적화 (user_id + asset_id + status)
    userAssetStatusIdx: index('idx_purchases_user_asset_status').on(table.userId, table.assetId, table.status),
    userIdIdx: index('idx_purchases_user_id').on(table.userId),
    assetIdIdx: index('idx_purchases_asset_id').on(table.assetId),
    statusIdx: index('idx_purchases_status').on(table.status),
    createdAtIdx: index('idx_purchases_created_at').on(table.createdAt),
    // Creator Referral Program indexes (partial indexes handled in migration)
    referralIdx: index('idx_purchases_referral').on(table.referralSessionId),
    // Stripe Connect Marketplace indexes
    paymentIntentIdIdx: index('idx_purchases_payment_intent_id').on(table.paymentIntentId),
    stripeCheckoutSessionIdIdx: index('idx_purchases_stripe_checkout_session_id').on(table.stripeCheckoutSessionId),
    stripeTransferIdx: index('idx_purchases_stripe_transfer_id').on(table.stripeTransferId),
    transferStatusIdx: index('idx_purchases_transfer_status').on(table.transferStatus),
    settlementMethodIdx: index('idx_purchases_settlement_method').on(table.settlementMethod),
  })
);

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;

/**
 * 수수료 계산 결과 타입 (Stripe Connect Marketplace)
 */
export type FeeCalculation = {
  totalAmount: number;         // 총 결제 금액 (cents)
  platformFeeRate: number;     // 수수료율 (0.00 ~ 1.00)
  platformFeeAmount: number;   // 플랫폼 수수료 (cents)
  creatorEarningAmount: number; // 크리에이터 수익 (cents)
};
