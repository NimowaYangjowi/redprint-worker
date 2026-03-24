/**
 * Admin Audit Logs 테이블 스키마
 * 관리자 작업의 감사 추적 (불변 로그)
 *
 * 용도:
 * - 분쟁 해결: 정확한 결정 내역 추적
 * - 컴플라이언스: 콘텐츠 심사 기록
 * - 디버깅: 예상치 못한 상태 변경 조사
 */

import { pgTable, text, timestamp, jsonb, index, uuid } from 'drizzle-orm/pg-core';

/**
 * Admin action types
 */
export const adminActionTypes = [
  'approve_media',
  'reject_media',
  'approve_model',
  'reject_model',
  'approve_revision',
  'reject_revision',
  'fail_model',           // Stale processing timeout
  'restore_model',        // Admin restore action
] as const;
export type AdminActionType = (typeof adminActionTypes)[number];

/**
 * Target entity types
 */
export const targetTypes = [
  'model',
  'media',
  'revision',
  'editor_image',
] as const;
export type TargetType = (typeof targetTypes)[number];

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    // UUID primary key (matches existing DB schema from migration 20251230)
    id: uuid('id').primaryKey().defaultRandom(),

    // Admin who performed the action (Clerk userId)
    adminId: text('admin_id').notNull(),

    // Action type
    action: text('action').notNull().$type<AdminActionType>(),

    // Target entity (nullable for generic audit logs without specific target)
    targetType: text('target_type').$type<TargetType>(),
    targetId: text('target_id'),

    // State before and after (for audit trail)
    previousState: jsonb('previous_state').$type<Record<string, unknown>>(),
    newState: jsonb('new_state').$type<Record<string, unknown>>(),

    // Reason for action (e.g., rejection reason)
    reason: text('reason'),

    // Additional metadata (e.g., batch info, related IDs)
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Request info for security auditing
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Timestamp (immutable - no updatedAt for audit logs)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Index names match existing migration (20251230172958)
    adminIdIdx: index('idx_admin_audit_logs_user').on(table.adminId),
    actionIdx: index('idx_admin_audit_logs_action').on(table.action),
    targetIdx: index('idx_admin_audit_logs_target').on(table.targetType, table.targetId),
    targetIdIdx: index('idx_admin_audit_logs_target_id').on(table.targetId),
    createdAtIdx: index('idx_admin_audit_logs_created').on(table.createdAt),
    // Composite index for querying admin actions by time
    adminTimeIdx: index('idx_admin_audit_logs_user_time').on(table.adminId, table.createdAt),
  })
);

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLogs.$inferInsert;

/**
 * Helper interface for creating audit log entries
 */
export interface CreateAuditLogParams {
  adminId: string;
  action: AdminActionType;
  targetType: TargetType;
  targetId: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}
