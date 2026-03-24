/**
 * Creator Pending Balances Table Schema
 *
 * Tracks pending earnings for creators who haven't connected Stripe.
 * This table aggregates pending amounts for performance optimization.
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
  index,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export const creatorPendingBalances = pgTable(
  'creator_pending_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Creator identification (references users.user_id)
    creatorId: text('creator_id')
      .notNull()
      .unique()
      .references(() => users.userId, { onDelete: 'cascade' }),

    // Pending balance (cents, USD)
    pendingAmountCents: integer('pending_amount_cents').notNull().default(0),
    pendingCount: integer('pending_count').notNull().default(0),

    // Settled total amount (historical tracking)
    settledAmountCents: integer('settled_amount_cents').notNull().default(0),
    settledCount: integer('settled_count').notNull().default(0),

    // Timestamps
    lastPurchaseAt: timestamp('last_purchase_at', { withTimezone: true }),
    lastSettledAt: timestamp('last_settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Indexes defined in migration, listed here for documentation
    creatorIdx: index('idx_cpb_creator').on(table.creatorId),
  })
);

// Inferred types
export type CreatorPendingBalance = typeof creatorPendingBalances.$inferSelect;
export type NewCreatorPendingBalance = typeof creatorPendingBalances.$inferInsert;

/**
 * Pending balance summary for API responses
 */
export interface PendingBalanceSummary {
  pendingAmountCents: number;
  pendingAmountUsd: number;
  pendingCount: number;
  settledAmountCents: number;
  settledAmountUsd: number;
  settledCount: number;
  lastPurchaseAt: string | null;
  lastSettledAt: string | null;
  canSettle: boolean;
  stripeStatus: {
    isConnected: boolean;
    chargesEnabled: boolean;
  };
}
