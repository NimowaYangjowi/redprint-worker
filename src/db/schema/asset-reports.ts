/**
 * Asset Reports 테이블 스키마
 * 부적절한 콘텐츠 신고 저장
 */

import { pgTable, uuid, varchar, text, timestamp, unique, index } from 'drizzle-orm/pg-core';

import { assets } from './assets';
import { users } from './users';

/**
 * Report reasons enum values
 */
export const REPORT_REASONS = [
  'plagiarism',
  'violence_gore',
  'hate_symbols',
  'security_concern',
  'deceptive',
  'spam',
  'other',
] as const;

export type ReportReason = typeof REPORT_REASONS[number];

/**
 * Report reason labels for UI display
 */
export const REPORT_REASON_LABELS: Record<ReportReason, { label: string; description: string }> = {
  plagiarism: {
    label: 'Plagiarism',
    description: 'Unauthorized copy of another creator\'s work',
  },
  violence_gore: {
    label: 'Intense Violence/Gore',
    description: 'Extreme violence or graphic content',
  },
  hate_symbols: {
    label: 'Hate Symbols',
    description: 'Hate speech or discriminatory symbols',
  },
  security_concern: {
    label: 'Potential Security Concern',
    description: 'Malware, phishing, or security threats',
  },
  deceptive: {
    label: 'Deceptive Content',
    description: 'Misleading or false information',
  },
  spam: {
    label: 'Spam',
    description: 'Spam or promotional content',
  },
  other: {
    label: 'Other',
    description: 'Other violation (please specify)',
  },
};

/**
 * Report status enum values
 */
export const REPORT_STATUSES = [
  'pending',
  'reviewing',
  'resolved',
  'dismissed',
] as const;

export type ReportStatus = typeof REPORT_STATUSES[number];

/**
 * Asset Reports Table
 * Stores user reports for inappropriate or violating content
 */
export const assetReports = pgTable('asset_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  reporterUserId: text('reporter_user_id').notNull().references(() => users.userId, { onDelete: 'cascade' }),

  // Report details
  reason: varchar('reason', { length: 50 }).notNull(),
  description: text('description'),

  // Admin workflow
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  adminNotes: text('admin_notes'),
  reviewedBy: text('reviewed_by').references(() => users.userId),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Constraints
  uniqueUserAssetReport: unique('unique_user_asset_report').on(table.assetId, table.reporterUserId),

  // Indexes
  assetIdIdx: index('idx_asset_reports_asset_id').on(table.assetId),
  statusIdx: index('idx_asset_reports_status').on(table.status),
  createdAtIdx: index('idx_asset_reports_created_at').on(table.createdAt),
  reasonIdx: index('idx_asset_reports_reason').on(table.reason),
  reporterIdx: index('idx_asset_reports_reporter').on(table.reporterUserId),
}));

// Type exports
export type AssetReport = typeof assetReports.$inferSelect;
export type NewAssetReport = typeof assetReports.$inferInsert;
