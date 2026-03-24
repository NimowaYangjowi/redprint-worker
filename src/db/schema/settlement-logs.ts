/**
 * Settlement Logs Table Schema
 *
 * Tracks settlement history for audit trail and debugging.
 * Records all transfer attempts (immediate, deferred, manual, batch).
 *
 * Deferred Settlement System - Phase 0
 *
 * @see plans/2026-01-03_deferred-settlement/01-phase0-data-model.md
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

import { purchases } from './purchases';
import { users } from './users';

/**
 * Settlement status enum
 *
 * pending: Waiting for processing
 * processing: Currently being processed (in-flight)
 * completed: Successfully settled
 * failed: Settlement failed (may retry)
 * cancelled: Cancelled (e.g., refunded before settlement)
 * reversed: Transfer reversed (dispute, refund, or manual reversal)
 */
export const settlementStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'] as const;
export type SettlementStatus = (typeof settlementStatuses)[number];

/**
 * Settlement type enum
 *
 * immediate: Instant settlement for connected creators (legacy direct transfer)
 * deferred: Delayed settlement after creator connects Stripe
 * manual: Admin-triggered settlement
 * batch: Batch settlement process
 * escrow: Unified escrow model - funds held on platform, then transferred via webhook
 */
export const settlementTypes = ['immediate', 'deferred', 'manual', 'batch', 'escrow'] as const;
export type SettlementType = (typeof settlementTypes)[number];

/**
 * Settlement log metadata type
 */
export interface SettlementMetadata {
  // For deferred settlements - original checkout session
  originalCheckoutSessionId?: string;
  // For batch settlements - included purchase IDs
  purchaseIds?: string[];
  // For partial refunds - refund history
  partialRefunds?: Array<{
    amount: number;
    refundedAt: string;
  }>;
  // Additional context
  [key: string]: unknown;
}

export const settlementLogs = pgTable(
  'settlement_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Settlement target
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    purchaseId: text('purchase_id')
      .references(() => purchases.id, { onDelete: 'set null' }),

    // Settlement amount
    amountCents: integer('amount_cents').notNull(),
    payoutFeeCents: integer('payout_fee_cents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),

    // Stripe information (nullable before settlement completes)
    stripeTransferId: text('stripe_transfer_id'),
    stripeAccountId: text('stripe_account_id'),

    // Status and error tracking
    status: text('status').$type<SettlementStatus>().notNull().default('pending'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),

    // Settlement type
    settlementType: text('settlement_type').$type<SettlementType>().notNull(),

    // Metadata (additional JSON information)
    metadata: jsonb('metadata').$type<SettlementMetadata>(),

    // Timestamps
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Indexes defined in migration, listed here for documentation
    creatorIdx: index('idx_sl_creator').on(table.creatorId),
    creatorStatusIdx: index('idx_sl_creator_status').on(table.creatorId, table.status),
    statusIdx: index('idx_sl_status').on(table.status),
    typeIdx: index('idx_sl_type').on(table.settlementType),
    createdIdx: index('idx_sl_created').on(table.createdAt),
  })
);

// Inferred types
export type SettlementLog = typeof settlementLogs.$inferSelect;
export type NewSettlementLog = typeof settlementLogs.$inferInsert;

// Note: Settlement-related response types are defined in src/lib/types/deferred-settlement.ts
// to maintain single source of truth. Re-export here for backward compatibility.
export type {
  SettleResult as SettlementResult,
  PendingPurchase,
  PendingPurchasesResponse,
} from '@/lib/types/deferred-settlement';
