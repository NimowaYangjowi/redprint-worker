use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

/// Initialize a PostgreSQL connection pool.
pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(30))
        .connect(database_url)
        .await
}

/// A currently-processing transcode job.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct JobInfo {
    pub id: String,
    pub job_type: String,
    pub media_id: String,
    pub started_at: Option<chrono::NaiveDateTime>,
}

/// Aggregate counts for today's completed and failed jobs.
#[derive(Debug, sqlx::FromRow)]
struct JobStats {
    completed: i32,
    failed: i32,
}

/// Query today's job statistics and the current processing job (if any).
///
/// Returns `(completed_count, failed_count, current_job)`.
pub async fn query_job_stats(pool: &PgPool) -> Result<(i32, i32, Option<JobInfo>), String> {
    let stats: JobStats = sqlx::query_as(
        "SELECT \
           COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= CURRENT_DATE)::int AS completed, \
           COUNT(*) FILTER (WHERE status IN ('failed', 'dead_letter') AND updated_at >= CURRENT_DATE)::int AS failed \
         FROM media_transcode_jobs",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to query job stats: {e}"))?;

    let current_job: Option<JobInfo> = sqlx::query_as(
        "SELECT id::text AS id, job_type, media_id::text AS media_id, started_at \
         FROM media_transcode_jobs \
         WHERE status = 'processing' \
         ORDER BY started_at DESC \
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to query current job: {e}"))?;

    Ok((stats.completed, stats.failed, current_job))
}

// ============================================================================
// Backup Stats
// ============================================================================

/// A single backup log entry for the monitoring dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BackupEntry {
    pub status: String,
    pub r2_key: Option<String>,
    pub file_size: Option<i32>,
    pub duration_ms: Option<i32>,
    pub retention_kept: Option<i32>,
    pub retention_deleted: Option<i32>,
    pub error_message: Option<String>,
    pub started_at: chrono::NaiveDateTime,
    pub completed_at: Option<chrono::NaiveDateTime>,
}

/// Total count of successful backups.
#[derive(Debug, sqlx::FromRow)]
struct BackupCount {
    total: i32,
}

/// Backup dashboard data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupStats {
    /// Most recent backup entry (if any)
    pub latest: Option<BackupEntry>,
    /// Total successful backups currently retained
    pub total_backups: i32,
    /// Recent backup history (up to 7 entries)
    pub history: Vec<BackupEntry>,
}

/// Query backup stats for the monitoring dashboard.
pub async fn query_backup_stats(pool: &PgPool) -> Result<BackupStats, String> {
    // Check if backup_logs table exists (graceful fallback)
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_logs')"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to check backup_logs table: {e}"))?;

    if !table_exists {
        return Ok(BackupStats {
            latest: None,
            total_backups: 0,
            history: vec![],
        });
    }

    // Most recent backup
    let latest: Option<BackupEntry> = sqlx::query_as(
        "SELECT status, r2_key, file_size, duration_ms, \
                retention_kept, retention_deleted, error_message, \
                started_at, completed_at \
         FROM backup_logs \
         ORDER BY started_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to query latest backup: {e}"))?;

    // Total successful backups
    let count: BackupCount = sqlx::query_as(
        "SELECT COUNT(*)::int AS total \
         FROM backup_logs \
         WHERE status = 'success'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to query backup count: {e}"))?;

    // Recent history (last 7)
    let history: Vec<BackupEntry> = sqlx::query_as(
        "SELECT status, r2_key, file_size, duration_ms, \
                retention_kept, retention_deleted, error_message, \
                started_at, completed_at \
         FROM backup_logs \
         ORDER BY started_at DESC LIMIT 7",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to query backup history: {e}"))?;

    Ok(BackupStats {
        latest,
        total_backups: count.total,
        history,
    })
}
