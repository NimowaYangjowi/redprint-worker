-- Migration: Create backup_logs table
-- Run this on your PostgreSQL database before enabling backup logging.
--
-- Usage:
--   psql $DATABASE_URL -f scripts/migrate-backup-logs.sql

CREATE TABLE IF NOT EXISTS backup_logs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  r2_key TEXT,
  file_size INTEGER,
  duration_ms INTEGER,
  retention_kept INTEGER,
  retention_deleted INTEGER,
  error_message TEXT,
  format_version TEXT,
  verification_status TEXT,
  verified_at TIMESTAMPTZ,
  verified_from_r2_key TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS backup_logs
  ADD COLUMN IF NOT EXISTS format_version TEXT;

ALTER TABLE IF EXISTS backup_logs
  ADD COLUMN IF NOT EXISTS verification_status TEXT;

ALTER TABLE IF EXISTS backup_logs
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS backup_logs
  ADD COLUMN IF NOT EXISTS verified_from_r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_backup_logs_started_at ON backup_logs(started_at DESC);
