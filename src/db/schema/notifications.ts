/**
 * Notifications 테이블 스키마
 * 사용자 알림 및 Admin 발송 기록
 *
 * - notifications: 개별 사용자 알림
 * - notification_broadcasts: Admin 발송 기록
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, index, integer, jsonb } from 'drizzle-orm/pg-core';

/**
 * 알림 유형
 * - admin: 관리자가 직접 발송한 알림
 * - system: 시스템 자동 알림
 * - model_published: 모델 심사 승인 알림
 * - model_not_published: 모델 심사 거부 알림
 * - review_needed: 심사 필요 알림 (Admin 전용)
 * - payment_error: 결제 처리 실패 알림 (Admin 전용)
 * - transfer_failed: 정산 전송 실패 알림 (Admin 전용)
 * - tagging_error: 태깅/미디어 처리 실패 알림 (Admin 전용)
 * - system_critical: 시스템 중요 에러 알림 (Admin 전용)
 * - payout_failed: 출금 실패 알림 (Creator)
 * - stripe_account_ready: Stripe 계정 활성화 알림 (Creator)
 * - stripe_account_restricted: Stripe 계정 제한 알림 (Creator)
 * - kyc_approved: Sphere KYC 승인 알림 (Creator)
 * - kyc_rejected: Sphere KYC 거절 알림 (Creator)
 * - wallet_verified: Crypto 지갑 소유권 검증 완료 알림 (Creator)
 * - crypto_payout_completed: Crypto 정산 완료 알림 (Creator)
 * - crypto_payout_failed: Crypto 정산 실패 알림 (Creator/Admin)
 * - creator_new_upload: 팔로우한 크리에이터가 새 에셋을 게시했을 때 (Follower)
 */
export type NotificationType =
  | 'admin'
  | 'system'
  | 'model_published'
  | 'model_not_published'
  | 'review_needed'
  | 'payment_error'
  | 'transfer_failed'
  | 'tagging_error'
  | 'system_critical'
  | 'payout_failed'
  | 'stripe_account_ready'
  | 'stripe_account_restricted'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'wallet_verified'
  | 'crypto_payout_completed'
  | 'crypto_payout_failed'
  | 'creator_new_upload';

/**
 * 대상 유형
 */
export type NotificationTargetType = 'all' | 'creators' | 'individual';

/**
 * 알림 메타데이터
 * 알림 클릭 시 이동할 링크 등 추가 정보
 */
export interface NotificationMetadata {
  /** 관련 에셋 ID */
  assetId?: string;
  /** 클릭 시 이동할 링크 */
  link?: string;
  /** 심사 거절 사유 (model_not_published 알림용) */
  rejectionReason?: string;
  /** 에러 관련 정보 (system_critical, payment_error 등) */
  error?: {
    /** 에러 코드 또는 타입 */
    code?: string;
    /** 에러 메시지 */
    message?: string;
    /** 관련 리소스 ID (sessionId, eventId, jobId 등) */
    resourceId?: string;
    /** 관련 리소스 타입 */
    resourceType?: 'session' | 'payment' | 'transfer' | 'tagging' | 'upload' | 'payout' | 'dispute' | 'refund' | 'account';
    /** 발생 시간 */
    occurredAt?: string;
  };
  /** Transfer 관련 정보 */
  transfer?: {
    /** Stripe PaymentIntent ID */
    paymentIntentId?: string;
    /** Creator ID */
    creatorId?: string;
    /** 실패 금액 (cents) */
    amount?: number;
  };
  /** Payout 관련 정보 (payout_failed) */
  payout?: {
    /** Stripe Payout ID */
    payoutId?: string;
    /** Stripe Connect Account ID */
    connectAccountId?: string;
    /** 금액 (cents) */
    amount?: number;
    /** 통화 */
    currency?: string;
    /** 실패 코드 */
    failureCode?: string | null;
    /** 실패 메시지 */
    failureMessage?: string | null;
  };
  /** Dispute 관련 정보 */
  dispute?: {
    /** Stripe Dispute ID */
    disputeId?: string;
    /** Stripe PaymentIntent ID */
    paymentIntentId?: string;
    /** Stripe Charge ID */
    chargeId?: string;
    /** 분쟁 금액 (cents) */
    amount?: number;
    /** 통화 */
    currency?: string;
    /** 분쟁 사유 */
    reason?: string | null;
    /** 분쟁 상태 */
    status?: string;
    /** 증거 제출 기한 */
    evidenceDueBy?: string | null;
    /** 영향받은 구매 수 */
    affectedPurchaseCount?: number;
  };
  /** Refund 관련 정보 */
  refund?: {
    /** Stripe Charge ID */
    chargeId?: string;
    /** Stripe PaymentIntent ID */
    paymentIntentId?: string | null;
    /** 환불 금액 (cents) */
    refundedAmount?: number;
    /** 원래 금액 (cents) */
    originalAmount?: number;
    /** 통화 */
    currency?: string;
    /** 환불 유형 */
    refundType?: 'full' | 'partial';
    /** 환불 사유 */
    reason?: string | null;
    /** 영향받은 구매 수 */
    affectedPurchaseCount?: number;
    /** 영향받은 Creator 수 */
    affectedCreatorCount?: number;
  };
  /** 크리에이터 정보 (creator_new_upload 알림용) */
  creatorId?: string;
  creatorName?: string;
  /** Stripe Account 관련 정보 */
  stripeAccount?: {
    /** Stripe Connect Account ID */
    connectAccountId?: string;
    /** 이전 상태 */
    previousStatus?: 'active' | 'pending' | 'restricted' | null;
    /** 현재 상태 */
    currentStatus?: 'active' | 'pending' | 'restricted';
    /** charges_enabled */
    chargesEnabled?: boolean;
    /** payouts_enabled */
    payoutsEnabled?: boolean;
    /** 필요 조치 사항 */
    requirements?: {
      currentlyDue?: string[];
      pastDue?: string[];
      eventuallyDue?: string[];
    } | null;
  };
}

/**
 * notifications 테이블
 * 개별 사용자에게 전달되는 알림
 */
export const notifications = pgTable(
  'notifications',
  {
    // Primary Key
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),

    // 수신자 (NULL = broadcast 알림, user_id 조건으로 조회)
    userId: text('user_id').notNull(),

    // 알림 내용
    title: text('title').notNull(),
    message: text('message').notNull(),

    // 알림 유형
    type: text('type').notNull().default('admin').$type<NotificationType>(),

    // 대상 그룹 (admin 발송 시 추적용)
    targetType: text('target_type').$type<NotificationTargetType>(),

    // 발송자 정보 (admin 알림의 경우)
    sentBy: text('sent_by'),

    // 연결된 broadcast ID (발송 기록 추적용)
    broadcastId: text('broadcast_id'),

    // 추가 메타데이터 (modelId, link 등)
    metadata: jsonb('metadata').$type<NotificationMetadata>(),

    // 읽음 상태
    readAt: timestamp('read_at', { withTimezone: true }),

    // 보존 정책 (Retention Policy)
    // unread: created_at + 90일, read: read_at + 30일
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Soft delete (Cleanup 시 사용)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_notifications_user_id').on(table.userId),
    userReadIdx: index('idx_notifications_user_read').on(table.userId, table.readAt),
    createdAtIdx: index('idx_notifications_created_at').on(table.createdAt.desc()),
    typeIdx: index('idx_notifications_type').on(table.type),
    broadcastIdIdx: index('idx_notifications_broadcast_id').on(table.broadcastId),
  })
);

/**
 * notification_broadcasts 테이블
 * Admin이 발송한 알림 기록
 */
export const notificationBroadcasts = pgTable(
  'notification_broadcasts',
  {
    // Primary Key
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),

    // 발송 내용
    title: text('title').notNull(),
    message: text('message').notNull(),

    // 대상 설정
    targetType: text('target_type').notNull().$type<NotificationTargetType>(),
    targetUserIds: text('target_user_ids').array(), // individual일 때 사용자 목록

    // 발송 정보
    sentBy: text('sent_by').notNull(),
    sentCount: integer('sent_count').default(0),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sentByIdx: index('idx_notification_broadcasts_sent_by').on(table.sentBy),
    createdAtIdx: index('idx_notification_broadcasts_created_at').on(table.createdAt.desc()),
  })
);

// Type exports
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationBroadcast = typeof notificationBroadcasts.$inferSelect;
export type NewNotificationBroadcast = typeof notificationBroadcasts.$inferInsert;
