/**
 * Version Revisions 테이블 스키마
 * 버전 내 published/draft content 분리를 위한 리비전 관리
 *
 * 핵심 개념:
 * - published revision: 유저에게 공개되는 현재 내용
 * - draft revision: 소유자가 수정 중인 내용 (심사 승인 전까지 비공개)
 */

import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

import { assetVersions } from './asset-versions';

/**
 * 리비전 상태 enum
 * Status flow: unpublished → submitted → processing → pending_review → published | rejected | archived
 *
 * - unpublished: 소유자 수정 중 (작업 진행 중, 기존 'draft'에서 리네임)
 * - submitted: 제출됨 (처리 대기)
 * - processing: 태깅 등 처리 중
 * - pending_review: 심사 대기
 * - published: 공개됨 (승인)
 * - rejected: 거절됨 (재수정 가능)
 * - archived: 보관됨 (이전 published)
 */
export const revisionStatusValues = [
  'unpublished',  // Being edited - renamed from 'draft'
  'submitted',    // Ready for processing
  'processing',
  'pending_review',
  'published',
  'rejected',
  'archived',
] as const;

export type RevisionStatus = (typeof revisionStatusValues)[number];

/**
 * 허용되는 상태 전이
 * Note: Matches model status transitions for consistency
 * Direct paths to processing/pending_review enable smart tagging bypass
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<RevisionStatus, RevisionStatus[]> = {
  unpublished: ['submitted', 'processing', 'pending_review'], // Submit, or direct path for smart tagging
  submitted: ['processing', 'pending_review', 'unpublished'], // Processing, direct review, or back to editing
  processing: ['pending_review', 'unpublished'],       // Complete or back to editing
  pending_review: ['published', 'rejected'],           // Admin decision
  published: ['archived'],                             // Can archive
  rejected: ['unpublished', 'submitted', 'processing', 'pending_review'], // Resubmit paths
  archived: [],                                        // Terminal state
};

export const versionRevisions = pgTable(
  'version_revisions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 버전 참조
    versionId: text('version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),

    // 리비전 상태
    status: text('status').$type<RevisionStatus>().notNull().default('unpublished'),

    // 수정 가능한 필드 (model_versions에서 리비전 레벨로 이동)
    description: text('description'),
    usageGuide: text('usage_guide'),

    // 생성 유형 (image, video)
    generationTypes: text('generation_types')
      .array()
      .$type<('image' | 'video')[]>()
      .default(['image']),

    // Note: LoRA-specific fields removed in prompt marketplace pivot (2026-02-23):
    // triggerWords, noTriggerWords, trainingParams, recommendedSettings, videoRecommendedSettings

    primaryMediaId: text('primary_media_id'),

    // 심사 관련
    rejectionReason: text('rejection_reason'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedBy: text('rejected_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionIdIdx: index('idx_version_revisions_version_id').on(table.versionId),
    statusIdx: index('idx_version_revisions_status').on(table.status),
    createdAtIdx: index('idx_version_revisions_created_at').on(table.createdAt.desc()),
  })
);

export type VersionRevision = typeof versionRevisions.$inferSelect;
export type NewVersionRevision = typeof versionRevisions.$inferInsert;

/**
 * 리비전 상태 전이가 유효한지 확인 (시스템 레벨 검증)
 *
 * Note: 이 함수는 version revision의 상태 전환을 검증합니다.
 * 사용자의 직접 액션(archive/unarchive)은 asset-updates.ts의 isValidUserStatusTransition을 사용하세요.
 *
 * @param currentStatus - 현재 리비전 상태
 * @param newStatus - 목표 리비전 상태
 * @returns 전환 가능 여부
 */
export function isValidStatusTransition(
  currentStatus: RevisionStatus,
  newStatus: RevisionStatus
): boolean {
  return ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(newStatus);
}

/**
 * 상태별 설명 (UI 표시용)
 */
export const REVISION_STATUS_LABELS: Record<RevisionStatus, string> = {
  unpublished: '수정 중',
  submitted: '제출됨',
  processing: '처리 중',
  pending_review: '심사 대기',
  published: '공개됨',
  rejected: '심사 거절',
  archived: '보관됨',
};

/**
 * 상태별 색상 (MUI Chip color)
 */
export const REVISION_STATUS_COLORS: Record<RevisionStatus, 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'info'> = {
  unpublished: 'default',
  submitted: 'primary',
  processing: 'info',
  pending_review: 'warning',
  published: 'success',
  rejected: 'error',
  archived: 'default',
};
