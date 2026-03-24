/**
 * Prompt Chains Table
 *
 * Stores multi-step prompt sequences for prompt chain assets.
 * Each step has its own prompt text, role, and optional parameter template.
 */
import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';

import { assets } from './assets';

export const promptChains = pgTable('prompt_chains', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  stepName: text('step_name'),
  promptText: text('prompt_text').notNull(),
  parameterTemplate: jsonb('parameter_template'),
  description: text('description'),
  negativePrompt: text('negative_prompt'),
  generationService: text('generation_service'),
  generationServiceOther: text('generation_service_other'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PromptChain = typeof promptChains.$inferSelect;
export type NewPromptChain = typeof promptChains.$inferInsert;
