/**
 * Sphere Webhook Events Schema
 * Idempotency tracking for Sphere webhook events
 *
 * Phase: Crypto Settlement Integration (Phase 2: Creator Onboarding)
 *
 * Purpose:
 * - Prevent duplicate webhook processing
 * - Audit trail for all Sphere events
 * - Status tracking for failed/pending events
 */

import {
  pgTable,
  text,
  timestamp,
  varchar,
  uuid,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';

/**
 * Webhook event processing status
 * processing: Currently being handled
 * completed: Successfully processed
 * failed: Processing failed (will retry)
 */
export const sphereWebhookStatuses = ['processing', 'completed', 'failed'] as const;
export type SphereWebhookStatus = (typeof sphereWebhookStatuses)[number];

/**
 * Known Sphere event types (using official Sphere API event names)
 *
 * Customer KYC Events:
 * - customer.kyc.successful: KYC verification approved
 * - customer.kyc.rejected: KYC verification rejected
 * - customer.kyc.pending: KYC documents submitted, under review
 * - customer.kyc.additionalReviewRequired: Additional documents required
 *
 * Payout Events:
 * - payout.successful: Crypto payout completed
 * - payout.failed: Crypto payout failed
 * - payout.processing: Crypto payout in progress
 *
 * Customer Events:
 * - customer.create: Customer account created
 */
export const sphereEventTypes = [
  // KYC events
  'customer.kyc.successful',
  'customer.kyc.rejected',
  'customer.kyc.pending',
  'customer.kyc.additionalReviewRequired',
  // Payout events
  'payout.successful',
  'payout.failed',
  'payout.processing',
  // Customer events
  'customer.create',
] as const;
export type SphereEventType = (typeof sphereEventTypes)[number];

/**
 * Sphere Webhook Events table
 * Tracks all webhook events from Sphere for idempotency
 *
 * Idempotency flow:
 * 1. Check if event_id exists with status IN ('processing', 'completed')
 * 2. If exists: return duplicate
 * 3. If not exists: INSERT with status='processing'
 * 4. Process event
 * 5. Update status to 'completed' or 'failed'
 */
export const sphereWebhookEvents = pgTable(
  'sphere_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: text('event_id').notNull().unique(),  // Sphere event ID (e.g., "evt_abc123")
    eventType: varchar('event_type', { length: 50 }),  // Event type (e.g., "kyc.approved")
    customerId: text('customer_id'),  // Sphere customer ID (e.g., "cus_xyz789")
    payload: jsonb('payload'),  // Full webhook payload (nullable - not all events need storage)
    status: varchar('status', { length: 20 }).notNull().default('processing'),  // CHECK IN statuses
    errorMessage: text('error_message'),  // Error details for failed events
    processedAt: timestamp('processed_at', { withTimezone: true }),  // When processing completed/failed
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_sphere_webhook_event_id').on(table.eventId),
    customerIdIdx: index('idx_sphere_webhook_customer').on(table.customerId),
    statusIdx: index('idx_sphere_webhook_events_status').on(table.status),
    eventTypeStatusIdx: index('idx_sphere_webhook_events_type_status').on(
      table.eventType,
      table.status
    ),
    createdAtIdx: index('idx_sphere_webhook_events_created_at').on(table.createdAt),
  })
);

export type SphereWebhookEvent = typeof sphereWebhookEvents.$inferSelect;
export type NewSphereWebhookEvent = typeof sphereWebhookEvents.$inferInsert;

/**
 * Sphere Webhook Payload (Event Object)
 *
 * Sphere sends "event" objects with at least:
 * - id: event id (evt_...)
 * - name: event name (e.g. customer.kyc.successful, payout.failed)
 * - data: event-specific payload
 *
 * Docs: https://docs.spherepay.co/guide/reference/webhooks/overview
 */
export type SphereWebhookPayload = {
  id: string;
  name: SphereEventType | string;
  data?: Record<string, unknown>;
  created?: string;
  updated?: string;
  mock?: boolean;
  webhookRecords?: Array<{
    webhookId?: string;
    success?: boolean;
    reason?: string;
  }>;
};
