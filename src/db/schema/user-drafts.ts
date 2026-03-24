/**
 * User Drafts 테이블 스키마
 * 사용자별 폼 드래프트 저장 (새 모델 생성/수정/새 버전 업로드 통합)
 *
 * Renamed from user_form_states → user_drafts (2026-01-23)
 * - Purpose: Store user-initiated form drafts (not model lifecycle status)
 *
 * Note: UNIQUE 제약조건 (user_id + COALESCE(model_id, '__NEW_MODEL__'))은
 * SQL 마이그레이션에서 정의됨 (Drizzle ORM에서 SQL 표현식 unique 미지원)
 */

import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { assets } from './assets';

import type { WorkDraftData, WorkflowMode } from '@/lib/types/work-draft';


export const userDrafts = pgTable(
  'user_drafts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 사용자 (Clerk user ID)
    userId: text('user_id').notNull(),

    // 대상 에셋 (NULL이면 새 에셋 생성 폼 드래프트)
    // NOTE: Legacy/current DB compatibility - physical column is still `model_id`.
    assetId: text('model_id').references(() => assets.id, { onDelete: 'cascade' }),

    // 드래프트 데이터 (JSON)
    // NOTE: Legacy/current DB compatibility - physical column is still `form_data`.
    draftData: jsonb('form_data').$type<WorkDraftData>().notNull().default({}),

    // 드래프트 타입 (model / workflow / prompt)
    // NOTE: Legacy/current DB compatibility - physical column is still `form_type`.
    draftType: text('form_type').notNull().default('model'),

    // 드래프트 모드 (create/edit/new-version)
    // NOTE: Legacy DB rows may have null before migration backfill.
    draftMode: text('draft_mode').$type<WorkflowMode>().notNull().default('create'),

    // 타임스탬프
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_user_drafts_user_id').on(table.userId),
    assetIdIdx: index('idx_user_drafts_model_id').on(table.assetId),
    draftModeIdx: index('idx_user_drafts_draft_mode').on(table.draftMode),
    updatedAtIdx: index('idx_user_drafts_updated_at').on(table.updatedAt.desc()),
  })
);

export type UserDraft = typeof userDrafts.$inferSelect;
export type NewUserDraft = typeof userDrafts.$inferInsert;
