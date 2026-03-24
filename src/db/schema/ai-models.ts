/**
 * AI Models Registry Table
 *
 * Reference table for supported AI models in the prompt marketplace.
 * Used for target model selection and compatibility tracking.
 */
import { pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const aiModels = pgTable('ai_models', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider'),
  category: text('category'),
  supportedOutputs: jsonb('supported_outputs').$type<string[]>(),
  isActive: boolean('is_active').default(true).notNull(),
  iconUrl: text('icon_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AiModel = typeof aiModels.$inferSelect;
export type NewAiModel = typeof aiModels.$inferInsert;
