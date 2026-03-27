/**
 * Media Variants Table
 * Stores transcoded media variant metadata (MP4, HEVC, etc.).
 */

import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { assetMedia } from './asset-media';

/** Variant type enum values */
export const variantTypeValues = ['video_mp4'] as const;
export type VariantType = (typeof variantTypeValues)[number];

export const mediaVariants = pgTable(
  'media_variants',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    /** Source media reference */
    mediaId: text('media_id')
      .notNull()
      .references(() => assetMedia.id, { onDelete: 'cascade' }),

    /** Variant type: video_mp4 */
    variantType: text('variant_type').notNull(),

    /** R2 storage key (e.g., variants/{mediaId}/video_mp4.mp4) */
    r2Key: text('r2_key').notNull(),

    /** Public URL */
    r2Url: text('r2_url').notNull(),

    /** File size in bytes */
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),

    /** MIME type (e.g., video/mp4) */
    format: text('format').notNull(),

    /** Width in pixels */
    width: integer('width'),

    /** Height in pixels */
    height: integer('height'),

    /** Video duration in seconds */
    duration: real('duration'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    mediaIdIdx: index('idx_variants_media_id').on(table.mediaId),
    mediaVariantUniqueIdx: uniqueIndex('idx_variants_media_variant_type').on(table.mediaId, table.variantType),
  })
);

export type MediaVariant = typeof mediaVariants.$inferSelect;
export type NewMediaVariant = typeof mediaVariants.$inferInsert;
