/**
 * Platform Feedback 테이블 스키마
 * 플랫폼 피드백 저장
 */

import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

import { purchases } from './purchases';
import { users } from './users';

/**
 * Feedback category enum values
 * Phase 1 DB CHECK 제약과 정확히 일치해야 함
 */
export const FEEDBACK_CATEGORIES = [
  'feature_request',
  'bug_report',
  'general',
  'praise',
  'complaint',
  'other',
] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

/**
 * Feedback category labels for UI display
 */
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, { label: string; description: string }> = {
  feature_request: {
    label: 'Feature Request',
    description: 'Suggest a new feature or improvement',
  },
  bug_report: {
    label: 'Bug Report',
    description: 'Report a problem or error',
  },
  general: {
    label: 'General Feedback',
    description: 'Share your thoughts about the platform',
  },
  praise: {
    label: 'Praise',
    description: 'Let us know what you love',
  },
  complaint: {
    label: 'Complaint',
    description: 'Tell us what went wrong',
  },
  other: {
    label: 'Other',
    description: 'Anything else you want to share',
  },
};

/**
 * Feedback status enum values
 * Phase 1 DB CHECK 제약과 정확히 일치해야 함
 */
export const FEEDBACK_STATUSES = [
  'pending',
  'reviewing',
  'resolved',
  'closed',
] as const;

export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];

/**
 * Platform Feedback Table
 */
export const platformFeedback = pgTable('platform_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),

  // User info (nullable for anonymous)
  userId: text('user_id').references(() => users.userId, { onDelete: 'set null' }),

  // Feedback content
  category: varchar('category', { length: 30 }).notNull(),
  rating: integer('rating'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  pageUrl: text('page_url'),
  userAgent: text('user_agent'),

  // Purchase context
  purchaseId: text('purchase_id').references(() => purchases.id, { onDelete: 'set null' }),

  // Admin workflow
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  adminResponse: text('admin_response'),
  reviewedBy: text('reviewed_by').references(() => users.userId, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Indexes (Phase 1과 일치)
  userIdIdx: index('idx_platform_feedback_user_id').on(table.userId),
  categoryIdx: index('idx_platform_feedback_category').on(table.category),
  statusIdx: index('idx_platform_feedback_status').on(table.status),
  createdAtIdx: index('idx_platform_feedback_created_at').on(table.createdAt),
  reviewedByIdx: index('idx_platform_feedback_reviewed_by').on(table.reviewedBy),
  purchaseIdIdx: index('idx_platform_feedback_purchase_id').on(table.purchaseId),
}));

// Type exports (Drizzle 추론)
export type PlatformFeedback = typeof platformFeedback.$inferSelect;
export type NewPlatformFeedback = typeof platformFeedback.$inferInsert;
