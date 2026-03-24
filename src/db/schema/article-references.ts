/**
 * Article References Schema
 * Manages linked references (Model, Workflow, Checkpoint) to articles
 *
 * NOTE: Polymorphic FK Design
 * - reference_id references models, workflows, or checkpoints tables
 * - DB-level FK constraint is NOT possible due to polymorphic nature
 * - API layer MUST verify:
 *   1. Reference exists in the referenced table
 *   2. User owns the reference before allowing connection
 *   3. Reference is in valid state (e.g., published, not deleted)
 */

import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { articles } from './articles';

// Reference Types
export const referenceTypeEnum = ['model', 'workflow', 'checkpoint'] as const;
export type ReferenceType = (typeof referenceTypeEnum)[number];

// Article References Table
export const articleReferences = pgTable(
  'article_references',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    articleId: text('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),

    // Polymorphic FK - no DB constraint
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),

    // Display Order
    displayOrder: integer('display_order').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_article_references_article_id').on(table.articleId),
    index('idx_article_references_reference').on(table.referenceType, table.referenceId),
    unique('article_references_unique').on(table.articleId, table.referenceType, table.referenceId),
  ]
);

// Type exports
export type ArticleReference = typeof articleReferences.$inferSelect;
export type NewArticleReference = typeof articleReferences.$inferInsert;
