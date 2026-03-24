/**
 * User Crypto Wallets table schema
 *
 * Crypto wallet connection history for creators.
 * Mirrors user_stripe_accounts pattern for consistency.
 *
 * @see plans/2026-01-24_stripe-crypto-commonization/phase-1-database-schema.md
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './users';

// ============================================================================
// Crypto Enums (moved from creator-payout-info)
// ============================================================================

/**
 * Crypto wallet networks
 */
export const cryptoWalletNetworks = ['sol', 'eth', 'polygon', 'base'] as const;
export type CryptoWalletNetwork = (typeof cryptoWalletNetworks)[number];

/**
 * Crypto KYC statuses
 * pending: Waiting
 * submitted: Submitted
 * approved: Approved
 * rejected: Rejected
 */
export const cryptoKycStatuses = ['pending', 'submitted', 'approved', 'rejected'] as const;
export type CryptoKycStatus = (typeof cryptoKycStatuses)[number];

/**
 * Tax form types
 * w9: US resident
 * w8ben: Non-US resident individual
 * w8bene: Non-US resident entity
 */
export const taxFormTypes = ['w9', 'w8ben', 'w8bene'] as const;
export type TaxFormType = (typeof taxFormTypes)[number];

// ============================================================================
// Status Enums (unique to this table)
// ============================================================================

/**
 * Wallet connection status
 * - active: Currently connected
 * - disconnected: User disconnected
 * - suspended: Platform suspended
 */
export const walletConnectionStatuses = ['active', 'disconnected', 'suspended'] as const;
export type WalletConnectionStatus = (typeof walletConnectionStatuses)[number];

/**
 * Disconnect reasons
 */
export const walletDisconnectReasons = [
  'user_initiated',
  'platform_revoked',
  'compliance_hold',
  'wallet_changed',
] as const;
export type WalletDisconnectReason = (typeof walletDisconnectReasons)[number];

// ============================================================================
// Table Definition
// ============================================================================

/**
 * User crypto wallet connection history
 *
 * Tracks all crypto wallet connections for creators, allowing:
 * - Connection history (similar to user_stripe_accounts)
 * - Multiple networks support
 * - KYC status tracking
 * - Tax form tracking
 */
export const userCryptoWallets = pgTable(
  'user_crypto_wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),

    // Wallet identifiers
    walletAddress: text('wallet_address').notNull(),
    walletNetwork: varchar('wallet_network', { length: 20 })
      .$type<CryptoWalletNetwork>()
      .notNull(),

    // Sphere integration
    sphereCustomerId: text('sphere_customer_id'),
    sphereWalletId: text('sphere_wallet_id'),

    // Status
    status: varchar('status', { length: 20 })
      .$type<WalletConnectionStatus>()
      .notNull()
      .default('active'),

    // Verification
    walletVerified: boolean('wallet_verified').notNull().default(false),
    kycStatus: varchar('kyc_status', { length: 20 })
      .$type<CryptoKycStatus>()
      .default('pending'),

    // Tax form
    taxFormType: varchar('tax_form_type', { length: 20 }),
    taxFormSubmittedAt: timestamp('tax_form_submitted_at', { withTimezone: true }),

    // Rejection
    rejectionReason: text('rejection_reason'),

    // Disconnect info
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    disconnectReason: varchar('disconnect_reason', { length: 50 })
      .$type<WalletDisconnectReason>(),

    // Timestamps
    connectedAt: timestamp('connected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_ucw_user_id').on(table.userId),
    walletAddressIdx: index('idx_ucw_wallet_address').on(table.walletAddress),
    sphereCustomerIdIdx: index('idx_ucw_sphere_customer_id').on(table.sphereCustomerId),
    sphereWalletIdIdx: index('idx_ucw_sphere_wallet_id').on(table.sphereWalletId),
    statusIdx: index('idx_ucw_status').on(table.status),
    // Partial unique: one active wallet per user
    activeUniqueIdx: uniqueIndex('idx_ucw_user_active_unique')
      .on(table.userId)
      .where(sql`status = 'active'`),
    // Unique wallet address (globally, only for active wallets)
    walletAddressUniqueIdx: uniqueIndex('idx_ucw_wallet_address_unique')
      .on(table.walletAddress)
      .where(sql`status = 'active'`),
  })
);

// ============================================================================
// Type Exports
// ============================================================================

export type UserCryptoWallet = typeof userCryptoWallets.$inferSelect;
export type NewUserCryptoWallet = typeof userCryptoWallets.$inferInsert;
