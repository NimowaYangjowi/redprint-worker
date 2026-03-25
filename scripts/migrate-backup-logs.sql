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
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_started_at ON backup_logs(started_at DESC);
