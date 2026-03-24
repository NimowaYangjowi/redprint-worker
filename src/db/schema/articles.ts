/**
 * Articles Schema
 * Main table for Guide/Breakdown articles
 * - Guide: Tutorials explaining how to reproduce something
 * - Breakdown: Pipeline or workflow explanations
 */

import { createId } from '@paralleldrive/cuid2';
import { boolean, index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Article Types
export const articleTypeEnum = ['guide', 'breakdown'] as const;
export type ArticleType = (typeof articleTypeEnum)[number];

// Article Status
export const articleStatusEnum = ['unpublished', 'published', 'archived'] as const;
export type ArticleStatus = (typeof articleStatusEnum)[number];

// Thumbnail Types
export const thumbnailTypeEnum = ['image', 'video'] as const;
export type ThumbnailType = (typeof thumbnailTypeEnum)[number];

// Articles Table
export const articles = pgTable(
  'articles',
  {
    // Using CUID2 for consistency with project patterns
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    authorId: text('author_id').notNull(),

    title: text('title').notNull(),
    slug: text('slug').unique().notNull(),
    summary: text('summary'),

    articleType: text('article_type').notNull().default('guide'),
    content: text('content'),

    thumbnailUrl: text('thumbnail_url'),
    thumbnailType: text('thumbnail_type').default('image'),

    status: text('status').notNull().default('unpublished'),

    // Statistics
    viewCount: integer('view_count').notNull().default(0),

    // ========== Monetization Fields (Phase 1: 2026-02) ==========
    /** Whether this article requires payment to access full content */
    isPaid: boolean('is_paid').notNull().default(false),
    /** Price in USD (NULL = free) */
    price: numeric('price', { precision: 10, scale: 2 }),
    /** Free preview content shown before paywall (markdown) */
    previewContent: text('preview_content'),
    /** Number of times article was downloaded/accessed after purchase */
    downloadCount: integer('download_count').notNull().default(0),
    /** Number of purchases (for paid articles) */
    purchaseCount: integer('purchase_count').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),

    // Soft Delete
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_articles_author_id').on(table.authorId),
    index('idx_articles_status').on(table.status),
    index('idx_articles_article_type').on(table.articleType),
    index('idx_articles_created_at').on(table.createdAt),
    index('idx_articles_published_at').on(table.publishedAt),
    // Monetization indexes
    index('idx_articles_is_paid').on(table.isPaid),
    index('idx_articles_price').on(table.price),
  ]
);

// Type exports
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
