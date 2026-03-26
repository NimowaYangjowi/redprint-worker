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
    pub format_version: Option<String>,
    pub verification_status: Option<String>,
    pub verified_at: Option<chrono::DateTime<chrono::Utc>>,
    pub verified_from_r2_key: Option<String>,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Total count of successful backups.
#[derive(Debug, sqlx::FromRow)]
struct BackupCount {
    total: i32,
}

const BACKUP_PHASE3_REQUIRED_COLUMNS: [&str; 4] = [
    "format_version",
    "verification_status",
    "verified_at",
    "verified_from_r2_key",
];

const BACKUP_SELECT_PHASE3_COLUMNS: &str =
    "status, r2_key, file_size, duration_ms, \
     retention_kept, retention_deleted, error_message, \
     format_version, verification_status, verified_at, verified_from_r2_key, \
     started_at, completed_at";

const BACKUP_SELECT_LEGACY_SAFE_COLUMNS: &str =
    "status, r2_key, file_size, duration_ms, \
     retention_kept, retention_deleted, error_message, \
     NULL::text AS format_version, \
     NULL::text AS verification_status, \
     NULL::timestamptz AS verified_at, \
     NULL::text AS verified_from_r2_key, \
     started_at, completed_at";

/// Backup dashboard data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupStats {
    /// Most recent backup entry (if any)
    pub latest: Option<BackupEntry>,
    /// Most recent restore-verified backup entry (if any)
    pub latest_verified: Option<BackupEntry>,
    /// Total successful backups currently retained
    pub total_backups: i32,
    /// Recent backup history (up to 7 entries)
    pub history: Vec<BackupEntry>,
}

async fn backup_logs_has_phase3_columns(pool: &PgPool) -> Result<bool, String> {
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name \
         FROM information_schema.columns \
         WHERE table_schema = 'public' \
           AND table_name = 'backup_logs' \
           AND column_name = ANY($1)",
    )
    .bind(&BACKUP_PHASE3_REQUIRED_COLUMNS)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to inspect backup_logs columns: {e}"))?;

    Ok(columns.len() == BACKUP_PHASE3_REQUIRED_COLUMNS.len())
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
            latest_verified: None,
            total_backups: 0,
            history: vec![],
        });
    }

    let has_phase3_columns = backup_logs_has_phase3_columns(pool).await?;

    // Most recent backup
    let latest_query = if has_phase3_columns {
        format!(
            "SELECT {} FROM backup_logs ORDER BY started_at DESC LIMIT 1",
            BACKUP_SELECT_PHASE3_COLUMNS
        )
    } else {
        format!(
            "SELECT {} FROM backup_logs ORDER BY started_at DESC LIMIT 1",
            BACKUP_SELECT_LEGACY_SAFE_COLUMNS
        )
    };
    let latest: Option<BackupEntry> = sqlx::query_as(&latest_query)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to query latest backup: {e}"))?;

    // Most recent restore-verified backup
    let latest_verified: Option<BackupEntry> = if has_phase3_columns {
        let query = format!(
            "SELECT {} \
             FROM backup_logs \
             WHERE status = 'success' AND verification_status = 'passed' \
             ORDER BY started_at DESC LIMIT 1",
            BACKUP_SELECT_PHASE3_COLUMNS
        );

        sqlx::query_as(&query)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query latest verified backup: {e}"))?
    } else {
        None
    };

    // Total restore-verified backups
    let count: BackupCount = if has_phase3_columns {
        sqlx::query_as(
            "SELECT COUNT(*)::int AS total \
             FROM backup_logs \
             WHERE status = 'success' AND verification_status = 'passed'",
        )
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to query backup count: {e}"))?
    } else {
        BackupCount { total: 0 }
    };

    // Recent history (last 7)
    let history_query = if has_phase3_columns {
        format!(
            "SELECT {} FROM backup_logs ORDER BY started_at DESC LIMIT 7",
            BACKUP_SELECT_PHASE3_COLUMNS
        )
    } else {
        format!(
            "SELECT {} FROM backup_logs ORDER BY started_at DESC LIMIT 7",
            BACKUP_SELECT_LEGACY_SAFE_COLUMNS
        )
    };
    let history: Vec<BackupEntry> = sqlx::query_as(&history_query)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to query backup history: {e}"))?;

    Ok(BackupStats {
        latest,
        latest_verified,
        total_backups: count.total,
        history,
    })
}
