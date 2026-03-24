/**
 * Upload Sessions 테이블 스키마
 * 원자적/멱등적 업로드를 위한 세션 상태 추적
 */

import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, integer, jsonb, index, unique } from 'drizzle-orm/pg-core';

import { assetVersions } from './asset-versions';
import { assets } from './assets';


/**
 * 업로드 세션 상태 enum
 * pending → drafting → uploading → completing → completed | failed | cancelled
 */
export const uploadSessionStatus = [
  'pending',
  'drafting',
  'uploading',
  'completing',
  'completed',
  'failed',
  'cancelled',
] as const;

export type UploadSessionStatus = (typeof uploadSessionStatus)[number];

/**
 * 실패한 파일 정보 타입
 */
export interface FailedFileInfo {
  fileId: string;
  error: string;
  timestamp: string;
}

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 연결 정보
    // NOTE:
    // DB legacy compatibility: upload_sessions still uses `model_id` column.
    // Keep property name `assetId` to align with the rest of the asset-based domain model.
    assetId: text('model_id').references(() => assets.id, { onDelete: 'cascade' }),
    versionId: text('version_id').references(() => assetVersions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),

    // 세션 상태
    status: text('status').notNull().default('pending'),

    // 진행 상황
    totalFiles: integer('total_files').notNull(),
    completedFiles: integer('completed_files').default(0),
    failedFiles: jsonb('failed_files').$type<FailedFileInfo[]>().default([]),
    expectedFileIds: text('expected_file_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // 업로드 메타
    clientPayloadHash: text('client_payload_hash').notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).defaultNow().notNull(),

    // 만료
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .default(sql`NOW() + INTERVAL '2 hours'`)
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    assetIdIdx: index('idx_upload_sessions_model_id').on(table.assetId),
    versionIdIdx: index('idx_upload_sessions_version_id').on(table.versionId),
    userIdIdx: index('idx_upload_sessions_user_id').on(table.userId),
    statusIdx: index('idx_upload_sessions_status').on(table.status),
    expiresAtIdx: index('idx_upload_sessions_expires_at').on(table.expiresAt),
    lastHeartbeatIdx: index('idx_upload_sessions_last_heartbeat').on(table.lastHeartbeatAt),
    uniquePayload: unique('uq_upload_sessions_payload').on(table.userId, table.clientPayloadHash),
  })
);

export type UploadSession = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;
