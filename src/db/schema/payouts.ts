/**
 * Payouts Table Schema
 *
 * Tracks Stripe payouts for connected accounts (payout.paid / payout.failed).
 * This enables reconciliation, creator support, and operational visibility.
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

/**
 * Stripe payout status (mirrors Stripe's payout.status field)
 */
export const payoutStatuses = [
  'paid',
  'failed',
  'pending',
  'in_transit',
  'canceled',
] as const;
export type PayoutStatus = (typeof payoutStatuses)[number];

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    stripePayoutId: text('stripe_payout_id').notNull().unique(),
    stripeAccountId: text('stripe_account_id').notNull(),

    creatorId: text('creator_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status').$type<PayoutStatus>().notNull(),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    arrivalDate: timestamp('arrival_date', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    creatorIdx: index('idx_payouts_creator').on(table.creatorId),
    statusIdx: index('idx_payouts_status').on(table.status),
    stripeAccountIdx: index('idx_payouts_stripe_account').on(table.stripeAccountId),
  })
);

export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;

