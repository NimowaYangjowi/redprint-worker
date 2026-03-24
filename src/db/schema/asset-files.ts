/**
 * Asset Files 테이블 스키마
 * 예시 결과물 파일 및 첨부 파일 메타데이터 저장
 * (Prompt marketplace pivot: 대용량 모델 파일 → 예시/첨부 파일)
 */

import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, integer, bigint, index } from 'drizzle-orm/pg-core';

import { assetVersions } from './asset-versions';

/**
 * 업로드 상태 enum
 * reserved → uploading → completed | failed
 */
export const uploadStatus = ['reserved', 'uploading', 'completed', 'failed'] as const;
export type UploadStatus = (typeof uploadStatus)[number];

/**
 * Content usage enum
 * - primary: Main example files
 * - dependency: Supporting/supplementary files
 */
export const contentUsages = ['primary', 'dependency'] as const;
export type ContentUsage = (typeof contentUsages)[number];

export const assetFiles = pgTable(
  'asset_files',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 버전 참조
    versionId: text('version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),

    // 업로드 세션 참조 (보상 트랜잭션용)
    sessionId: text('session_id'),

    // 파일 정보
    fileName: text('file_name').notNull(),
    fileType: text('file_type').notNull(), // 'example_svg' | 'example_code' | 'example_asset' | 'example_image' | 'attachment'
    fileExtension: text('file_extension').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(), // bytes

    // R2 스토리지 정보
    r2Key: text('r2_key').notNull(), // Cloudflare R2 object key
    r2Url: text('r2_url').notNull(), // Public URL

    // 업로드 상태 (Saga Pattern용)
    uploadStatus: text('upload_status').default('completed'),

    // 다운로드 통계
    downloadCount: integer('download_count').default(0),

    // Content usage: primary (main model files) or dependency (seller-provided dependency files)
    contentUsage: text('content_usage').notNull().default('primary').$type<ContentUsage>(),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdIdx: index('idx_asset_files_version_id').on(table.versionId),
    fileTypeIdx: index('idx_asset_files_file_type').on(table.fileType),
    sessionIdIdx: index('idx_asset_files_session_id').on(table.sessionId),
    uploadStatusIdx: index('idx_asset_files_upload_status').on(table.uploadStatus),
    contentUsageIdx: index('idx_asset_files_content_usage').on(table.contentUsage),
  })
);

export type AssetFile = typeof assetFiles.$inferSelect;
export type NewAssetFile = typeof assetFiles.$inferInsert;
