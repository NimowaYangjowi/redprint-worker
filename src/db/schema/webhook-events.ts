/**
 * Webhook Events 테이블 스키마
 * Stripe 웹훅 이벤트 추적 및 멱등성 보장
 *
 * Phase 5: Webhook 확장 및 Payout
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * 웹훅 이벤트 상태 enum
 * processing: 처리 중
 * completed: 처리 완료
 * failed: 처리 실패
 */
export const webhookEventStatus = ['processing', 'completed', 'failed'] as const;
export type WebhookEventStatus = (typeof webhookEventStatus)[number];

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    stripeEventId: text('stripe_event_id').unique().notNull(),
    eventType: text('event_type').notNull(),
    status: text('status').notNull().default('processing'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    // stripeEventId is unique(), which already creates an index. Keep only createdAt index.
    createdAtIdx: index('idx_webhook_events_created_at').on(table.createdAt),
  })
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
