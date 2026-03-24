/**
 * Creator Tax Forms Schema
 * Encrypted storage for tax form data (W-9, W-8BEN, W-8BEN-E)
 *
 * Phase: Crypto Settlement Integration
 *
 * Security Requirements:
 * - SEC-PII-003: Tax form data must be encrypted (AES-256-GCM)
 * - SEC-KEY-001: Encryption key versioning for rotation
 * - SEC-ACCESS-001: Service role only access (RLS enforced)
 */

import {
  pgTable,
  text,
  timestamp,
  varchar,
  uuid,
  index,
  unique,
} from 'drizzle-orm/pg-core';

import { users } from './users';

import type { TaxFormType } from './user-crypto-wallets';

/**
 * Creator Tax Forms table
 * Stores encrypted tax form submissions
 *
 * Encryption:
 * - encrypted_data: AES-256-GCM encrypted JSON payload
 * - encryption_key_id: References key version for rotation
 *
 * Constraints:
 * - One active form per creator per form type
 * - Service role only access (enforced by RLS)
 */
export const creatorTaxForms = pgTable(
  'creator_tax_forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    formType: varchar('form_type', { length: 20 }).notNull(),  // CHECK IN ('w9', 'w8ben', 'w8bene')
    encryptedData: text('encrypted_data').notNull(),  // AES-256-GCM encrypted JSON
    encryptionKeyId: text('encryption_key_id').notNull(),  // Key version for rotation
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    creatorIdIdx: index('idx_creator_tax_forms_creator').on(table.creatorId),
    // Unique constraint: one active form per creator per form type
    uniqueCreatorFormType: unique('idx_creator_tax_forms_unique_active').on(
      table.creatorId,
      table.formType
    ),
  })
);

export type CreatorTaxForm = typeof creatorTaxForms.$inferSelect;
export type NewCreatorTaxForm = typeof creatorTaxForms.$inferInsert;

/**
 * W-9 Form Data (US Persons)
 */
export type W9FormData = {
  name: string;
  businessName?: string;
  taxClassification: 'individual' | 'c_corp' | 's_corp' | 'partnership' | 'trust' | 'llc' | 'other';
  exemptPayeeCode?: string;
  exemptFatcaCode?: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  accountNumbers?: string[];
  tinType: 'ssn' | 'ein';
  tin: string;  // Social Security Number or Employer Identification Number (encrypted)
  signature: string;
  signedAt: string;  // ISO 8601 timestamp
};

/**
 * W-8BEN Form Data (Non-US Individuals)
 */
export type W8BENFormData = {
  name: string;
  countryOfCitizenship: string;
  permanentAddress: string;
  city: string;
  country: string;
  mailingAddress?: string;
  usTin?: string;
  foreignTin?: string;
  referenceNumber?: string;
  dateOfBirth?: string;
  claimOfTaxTreatyBenefits?: {
    countryOfResidence: string;
    articleNumber: string;
    rate: number;
    typeOfIncome: string;
    additionalConditions?: string;
  };
  signature: string;
  signedAt: string;  // ISO 8601 timestamp
};

/**
 * W-8BEN-E Form Data (Non-US Entities)
 */
export type W8BENEFormData = {
  organizationName: string;
  countryOfIncorporation: string;
  disregardedEntity?: boolean;
  permanentAddress: string;
  city: string;
  country: string;
  mailingAddress?: string;
  usTin?: string;
  foreignTin?: string;
  referenceNumber?: string;
  chapter3Status: string;
  chapter4Status: string;
  fatcaFilingRequirement?: string;
  claimOfTaxTreatyBenefits?: {
    countryOfResidence: string;
    articleNumber: string;
    rate: number;
    typeOfIncome: string;
    limitationOnBenefits?: string;
  };
  signature: string;
  signedAt: string;  // ISO 8601 timestamp
  signerCapacity: string;
};

/**
 * Union type for all tax form data
 */
export type TaxFormData = W9FormData | W8BENFormData | W8BENEFormData;

/**
 * Encrypted tax form payload structure
 * This is what gets encrypted and stored in encrypted_data column
 */
export type EncryptedTaxFormPayload = {
  formType: TaxFormType;
  formData: TaxFormData;
  submittedAt: string;  // ISO 8601 timestamp
  ipAddress?: string;
  userAgent?: string;
};
