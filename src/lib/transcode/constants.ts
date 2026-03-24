/**
 * Transcode Pipeline Constants
 * Operational parameters for the local-only media transcoding system.
 */

// ============================================================================
// Lease & Heartbeat
// ============================================================================

/** Initial lease duration when claiming a job (15 minutes) */
export const LEASE_DURATION_MS = 900_000;

/** How often the worker extends leaseExpiresAt (60 seconds) */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/** How often the sweeper checks for expired leases (5 minutes) */
export const STALE_SWEEPER_INTERVAL_MS = 300_000;

// ============================================================================
// Worker Polling & Backoff
// ============================================================================

/** Base polling interval when queue has jobs (2 seconds) */
export const POLL_BASE_MS = 2_000;

/** Maximum backoff when queue is empty (30 seconds) */
export const POLL_MAX_MS = 30_000;

/** Exponential backoff multiplier */
export const POLL_BACKOFF_FACTOR = 1.5;

// ============================================================================
// Disk & Temp
// ============================================================================

/** Pause claiming when free disk falls below this (GB) */
export const MIN_FREE_DISK_GB = 10;

/** Base temp directory for transcode jobs */
export const TEMP_DIR_BASE = '/tmp/redprint-transcode';

// ============================================================================
// Graceful Shutdown
// ============================================================================

/** Max wait for current job on SIGTERM (30 seconds) */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

// ============================================================================
// Job Defaults
// ============================================================================

/** Default max retries before dead_letter */
export const DEFAULT_MAX_RETRIES = 3;

// ============================================================================
// FFmpeg Parameters
// ============================================================================

/** Video MP4 FFmpeg encoding parameters */
export const VIDEO_MP4_PARAMS = {
  codec: 'libx264',
  crf: 20,
  preset: 'medium',
  audioCodec: 'aac',
  audioBitrate: '128k',
} as const;

// ============================================================================
// Environment Helpers
// ============================================================================

/** Check if the transcode pipeline is enabled */
export const isPipelineEnabled = () =>
  process.env.TRANSCODE_PIPELINE_ENABLED === 'true';

/** Check if dry-run mode is active (worker skips ffmpeg/R2) */
export const isDryRun = () =>
  process.env.TRANSCODE_DRY_RUN === 'true';
