/**
 * Database Client
 * Drizzle ORM + PostgreSQL (Supabase / Railway compatible)
 *
 * @see analysis/railway-migration/04_drizzle-serverless-config.md
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

const connectionString = process.env.VERCEL_ENV === 'production' &&
  process.env.PRODUCTION_DATABASE_URL?.trim()
  ? process.env.PRODUCTION_DATABASE_URL
  : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL (or PRODUCTION_DATABASE_URL in production) is not set');
}

// Detect serverless environment (Vercel, AWS Lambda, etc.)
const isServerless = process.env.VERCEL === '1' ||
  process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;

// Connection pool configuration optimized for serverless
// @see https://orm.drizzle.team/docs/get-started-postgresql#postgres.js
// @see plans/2026-01-25_railway-migration/phase-0-prerequisites.md
const client = postgres(connectionString, {
  // Serverless: 1 connection per function instance (most conservative, prevents connection exhaustion)
  // Local/Container: 10 connections for better throughput
  max: isServerless ? 1 : 10,
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
  prepare: false, // Disable prepared statements for PgBouncer compatibility
  max_lifetime: 60 * 30, // Recreate connections after 30 minutes (prevents stale connections)
  connection: {
    // Application name for monitoring and debugging in pg_stat_activity
    application_name: `redprint-${process.env.NODE_ENV || 'development'}`,
  },
});

export const db = drizzle(client, {
  schema,
});

export * from './schema';
