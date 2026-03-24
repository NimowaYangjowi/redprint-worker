/**
 * Crypto Compliance Audit Log Schema
 * Tracks all OFAC/sanctions compliance checks for crypto settlements
 *
 * Phase: Crypto Settlement Integration (Phase 4)
 *
 * Purpose:
 * - Audit trail for all compliance checks
 * - Track blocked transactions for regulatory compliance
 * - Enable compliance reporting and analytics
 */

import {
  pgTable,
  text,
  timestamp,
  varchar,
  uuid,
  boolean,
  index,
  inet,
} from 'drizzle-orm/pg-core';

/**
 * Compliance check types
 */
export const complianceCheckTypes = [
  'crypto_settlement',
  'wallet_registration',
  'kyc_verification',
] as const;
export type ComplianceCheckType = (typeof complianceCheckTypes)[number];

/**
 * Crypto Compliance Audit Log table
 * Stores all compliance check results for audit purposes
 */
export const cryptoComplianceAuditLog = pgTable(
  'crypto_compliance_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id').notNull(),
    countryCode: varchar('country_code', { length: 2 }),
    checkType: varchar('check_type', { length: 50 }).notNull().default('crypto_settlement'),
    allowed: boolean('allowed').notNull(),
    blocked: boolean('blocked').notNull(),
    reason: text('reason').notNull(),
    // Additional context for audit
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    requestId: uuid('request_id'),
    // Timestamps
    checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    creatorIdIdx: index('idx_compliance_audit_creator_id').on(table.creatorId),
    countryIdx: index('idx_compliance_audit_country').on(table.countryCode),
    checkedAtIdx: index('idx_compliance_audit_checked_at').on(table.checkedAt),
  })
);

export type CryptoComplianceAuditLog = typeof cryptoComplianceAuditLog.$inferSelect;
export type NewCryptoComplianceAuditLog = typeof cryptoComplianceAuditLog.$inferInsert;
