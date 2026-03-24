/**
 * Drizzle ORM Relations (domain-split)
 * Defines table relations for use with db.query.* relational API.
 * The transcode worker uses standard queries (select/update/insert)
 * and does not use the relational query builder.
 */

import { relations } from 'drizzle-orm';

import { assetMedia } from './asset-media';
import { mediaTranscodeJobs } from './media-transcode-jobs';
import { mediaVariants } from './media-variants';

export const assetMediaRelations = relations(assetMedia, ({ many }) => ({
  transcodeJobs: many(mediaTranscodeJobs),
  variants: many(mediaVariants),
}));

export const mediaTranscodeJobsRelations = relations(mediaTranscodeJobs, ({ one }) => ({
  media: one(assetMedia, {
    fields: [mediaTranscodeJobs.mediaId],
    references: [assetMedia.id],
  }),
}));

export const mediaVariantsRelations = relations(mediaVariants, ({ one }) => ({
  media: one(assetMedia, {
    fields: [mediaVariants.mediaId],
    references: [assetMedia.id],
  }),
}));
