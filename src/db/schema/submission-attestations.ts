/**
 * Submission Attestations Table Schema
 * Records user acceptance of terms before asset submission.
 *
 * Purpose:
 * - Auditable proof that the user agreed to terms and confirmed consistent output
 * - Server-side enforcement (frontend validation alone is insufficient)
 * - Linked to the exact asset, version, and revision being submitted
 *
 * Policy: ipAddress and userAgent are NOT stored (privacy policy decision).
 */

import { pgTable, serial, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

import { assetVersions } from './asset-versions';
import { assets } from './assets';
import { versionRevisions } from './version-revisions';

export const submissionAttestations = pgTable(
  'submission_attestations',
  {
    id: serial('id').primaryKey(),

    // Who attested
    userId: text('user_id').notNull(),

    // What was attested for (full lineage: asset -> version -> revision)
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => versionRevisions.id, { onDelete: 'cascade' }),

    // Attestation fields
    agreeToTerms: boolean('agree_to_terms').notNull().default(false),
    confirmsConsistentOutput: boolean('confirms_consistent_output').notNull().default(false),

    // Version of the terms accepted (date-based for auditability)
    termsVersion: text('terms_version').notNull(),

    // When the attestation was recorded
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_submission_attestations_user_id').on(table.userId),
    assetIdIdx: index('idx_submission_attestations_asset_id').on(table.assetId),
    versionIdIdx: index('idx_submission_attestations_version_id').on(table.versionId),
    revisionIdIdx: index('idx_submission_attestations_revision_id').on(table.revisionId),
    acceptedAtIdx: index('idx_submission_attestations_accepted_at').on(table.acceptedAt.desc()),
  })
);

export type SubmissionAttestation = typeof submissionAttestations.$inferSelect;
export type NewSubmissionAttestation = typeof submissionAttestations.$inferInsert;
