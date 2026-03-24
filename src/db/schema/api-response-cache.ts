/**
 * API Response Cache Table Schema
 *
 * DB 기반 API 응답 캐시를 저장합니다.
 * 주 사용처: Explore 목록 API (GET /api/assets)
 */

import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const apiResponseCache = pgTable(
  'api_response_cache',
  {
    // Deterministic cache key (e.g., assets:list:v1:{sha256})
    cacheKey: text('cache_key').primaryKey(),

    // Route-level namespace for operational visibility
    route: text('route').notNull(),

    // Cached response payload (JSON serializable)
    payload: jsonb('payload').notNull(),

    // TTL expiration
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    routeExpiresIdx: index('idx_api_response_cache_route_expires').on(table.route, table.expiresAt),
    expiresAtIdx: index('idx_api_response_cache_expires_at').on(table.expiresAt),
  })
);

export type ApiResponseCache = typeof apiResponseCache.$inferSelect;
export type NewApiResponseCache = typeof apiResponseCache.$inferInsert;
