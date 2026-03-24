/**
 * Crypto Settlement Schema
 * Tables for tracking crypto payouts via Sphere
 *
 * Phase: Crypto Settlement Integration
 *
 * Tables:
 * - negative_balance: 환불/차지백으로 인한 마이너스 잔고 추적
 * - crypto_settlement_log: 개별 암호화폐 정산 기록
 * - crypto_settlement_batches: 정산 배치 관리
 * - idempotency_log: 멱등성 보장을 위한 로그
 */

import {
  pgTable,
  text,
  timestamp,
  varchar,
  uuid,
  index,
  integer,
  decimal,
  jsonb,
} from 'drizzle-orm/pg-core';

import { purchases } from './purchases';
import { users } from './users';

// ============================================================================
// Negative Balance Table
// ============================================================================

/**
 * 마이너스 잔고 발생 이유
 * refund: 환불
 * chargeback: 차지백
 * adjustment: 수동 조정
 */
export const negativeBalanceReasons = ['refund', 'chargeback', 'adjustment'] as const;
export type NegativeBalanceReason = (typeof negativeBalanceReasons)[number];

/**
 * 마이너스 잔고 상태
 * pending: 회수 대기
 * recovered: 회수 완료
 * written_off: 손실 처리
 */
export const negativeBalanceStatuses = ['pending', 'recovered', 'written_off'] as const;
export type NegativeBalanceStatus = (typeof negativeBalanceStatuses)[number];

/**
 * 크리에이터의 마이너스 잔고 추적
 * 환불/차지백 발생 시 기록하고 향후 정산에서 차감
 */
export const negativeBalance = pgTable(
  'negative_balance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),  // CHECK > 0 (migration에서 처리)
    reason: varchar('reason', { length: 50 }).notNull(),  // CHECK IN ('refund', 'chargeback', 'adjustment')
    purchaseId: text('purchase_id').references(() => purchases.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),  // CHECK IN statuses
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
    notes: text('notes'),

    // Phase 1: Idempotency key for webhook deduplication
    // NOTE: Uniqueness enforced via partial unique index in migration, not column-level
    idempotencyKey: text('idempotency_key'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    creatorIdIdx: index('idx_negative_balance_creator_id').on(table.creatorId),
    statusIdx: index('idx_negative_balance_status').on(table.status),
    purchaseIdIdx: index('idx_negative_balance_purchase_id').on(table.purchaseId),
    createdAtIdx: index('idx_negative_balance_created_at').on(table.createdAt),
    // Composite index for pending balances by creator
    creatorStatusIdx: index('idx_negative_balance_creator_status').on(table.creatorId, table.status),
  })
);

export type NegativeBalance = typeof negativeBalance.$inferSelect;
export type NewNegativeBalance = typeof negativeBalance.$inferInsert;

// ============================================================================
// Crypto Settlement Log Table
// ============================================================================

/**
 * 암호화폐 지갑 네트워크
 */
export const cryptoNetworks = ['sol', 'eth', 'polygon', 'base'] as const;
export type CryptoNetwork = (typeof cryptoNetworks)[number];

/**
 * 암호화폐 정산 상태
 * initiated: Sphere payout 생성됨 (첫 상태 이벤트 대기)
 * pending: 처리 대기
 * processing: 처리 중
 * completed: 완료
 * failed: 실패
 * cancelled: 취소됨 (Phase 1 추가)
 * refunded: 환불됨 (Phase 1 추가)
 */
export const cryptoSettlementStatuses = [
  'initiated',
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'refunded',
] as const;
export type CryptoSettlementStatus = (typeof cryptoSettlementStatuses)[number];

/**
 * 개별 암호화폐 정산 기록
 * Sphere를 통한 각 정산 트랜잭션 추적
 */
export const cryptoSettlementLog = pgTable(
  'crypto_settlement_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: text('batch_id').notNull(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    sphereTransferId: text('sphere_transfer_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    amountUsd: decimal('amount_usd', { precision: 10, scale: 2 }).notNull(),
    network: varchar('network', { length: 20 }).notNull(),  // CHECK IN networks
    walletAddress: text('wallet_address').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),  // CHECK IN statuses
    txHash: text('tx_hash'),
    errorMessage: text('error_message'),
    idempotencyKey: text('idempotency_key').notNull().unique(),

    // Phase 1: Refund and cancellation tracking
    refundTxHash: text('refund_tx_hash'),
    refundAmountUsd: decimal('refund_amount_usd', { precision: 10, scale: 2 }),
    cancellationReason: text('cancellation_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    batchIdIdx: index('idx_crypto_settlement_log_batch_id').on(table.batchId),
    creatorIdIdx: index('idx_crypto_settlement_log_creator_id').on(table.creatorId),
    sphereTransferIdIdx: index('idx_crypto_settlement_log_sphere_transfer_id').on(table.sphereTransferId),
    statusIdx: index('idx_crypto_settlement_log_status').on(table.status),
    networkIdx: index('idx_crypto_settlement_log_network').on(table.network),
    createdAtIdx: index('idx_crypto_settlement_log_created_at').on(table.createdAt),
    // Composite index for batch processing
    batchStatusIdx: index('idx_crypto_settlement_log_batch_status').on(table.batchId, table.status),
  })
);

export type CryptoSettlementLog = typeof cryptoSettlementLog.$inferSelect;
export type NewCryptoSettlementLog = typeof cryptoSettlementLog.$inferInsert;

// ============================================================================
// Crypto Settlement Batches Table
// ============================================================================

/**
 * 배치 상태
 * pending: 생성됨, 처리 대기
 * processing: 처리 중
 * completed: 모든 항목 완료
 * partial: 일부 성공, 일부 실패
 * failed: 모든 항목 실패
 */
export const batchStatuses = ['pending', 'processing', 'completed', 'partial', 'failed'] as const;
export type BatchStatus = (typeof batchStatuses)[number];

/**
 * 암호화폐 정산 배치 관리
 * 여러 크리에이터 정산을 배치로 묶어서 처리
 */
export const cryptoSettlementBatches = pgTable(
  'crypto_settlement_batches',
  {
    id: text('id').primaryKey(),  // batch_{timestamp}_{uuid} format
    totalAmountUsd: decimal('total_amount_usd', { precision: 12, scale: 2 }).notNull(),
    itemCount: integer('item_count').notNull(),
    successCount: integer('success_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('pending'),  // CHECK IN statuses
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_crypto_settlement_batches_status').on(table.status),
    createdAtIdx: index('idx_crypto_settlement_batches_created_at').on(table.createdAt),
  })
);

export type CryptoSettlementBatch = typeof cryptoSettlementBatches.$inferSelect;
export type NewCryptoSettlementBatch = typeof cryptoSettlementBatches.$inferInsert;

// ============================================================================
// Idempotency Log Table
// ============================================================================

/**
 * 작업 타입
 */
export const operationTypes = [
  'crypto_settlement',
  'batch_settlement',
  'refund_process',
  'wallet_verification',
] as const;
export type OperationType = (typeof operationTypes)[number];

/**
 * 멱등성 로그
 * 동일한 작업이 중복 실행되지 않도록 보장
 */
export const idempotencyLog = pgTable(
  'idempotency_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    operationType: varchar('operation_type', { length: 50 }).notNull(),
    result: jsonb('result'),  // 작업 결과 저장
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    keyIdx: index('idx_idempotency_log_key').on(table.key),
    operationTypeIdx: index('idx_idempotency_log_operation_type').on(table.operationType),
    expiresAtIdx: index('idx_idempotency_log_expires_at').on(table.expiresAt),
    // Composite index for cleanup queries
    expiresCreatedIdx: index('idx_idempotency_log_expires_created').on(table.expiresAt, table.createdAt),
  })
);

export type IdempotencyLog = typeof idempotencyLog.$inferSelect;
export type NewIdempotencyLog = typeof idempotencyLog.$inferInsert;

// ============================================================================
// Helper Types
// ============================================================================

/**
 * 정산 배치 요약
 */
export type BatchSummary = {
  batchId: string;
  totalAmountUsd: number;
  itemCount: number;
  successCount: number;
  failedCount: number;
  status: BatchStatus;
  createdAt: Date;
  completedAt?: Date;
};

/**
 * 크리에이터 마이너스 잔고 요약
 */
export type NegativeBalanceSummary = {
  creatorId: string;
  totalPendingCents: number;
  totalRecoveredCents: number;
  pendingCount: number;
};

/**
 * 암호화폐 정산 통계
 */
export type CryptoSettlementStats = {
  totalSettledUsd: number;
  totalPendingUsd: number;
  successRate: number;
  averageSettlementTimeMs: number;
  byNetwork: Record<CryptoNetwork, {
    count: number;
    totalUsd: number;
  }>;
};
