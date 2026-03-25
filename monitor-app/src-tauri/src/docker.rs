use serde::Serialize;
use std::process::Command;
use tauri::State;

use crate::config::EXEC_PATH;

#[derive(Serialize, Clone, Debug)]
pub struct WorkerStatus {
    pub container_state: String,
    pub current_job: Option<serde_json::Value>,
    pub today_completed: i32,
    pub today_failed: i32,
    pub db_connected: bool,
    pub last_updated: Option<String>,
    pub backup: Option<crate::db::BackupStats>,
}

impl Default for WorkerStatus {
    fn default() -> Self {
        Self {
            container_state: "unknown".to_string(),
            current_job: None,
            today_completed: 0,
            today_failed: 0,
            db_connected: false,
            last_updated: None,
            backup: None,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct ActionResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Query the Docker container state via `docker inspect`.
/// Returns the container status string (e.g. "running", "exited") or "not_found" on error.
pub fn get_container_state(container_name: &str) -> String {
    let result = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{.State.Status}}",
            container_name,
        ])
        .env("PATH", EXEC_PATH)
        .output();

    match result {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => "not_found".to_string(),
    }
}

/// Tauri command: return the current cached worker status.
#[tauri::command]
pub async fn get_status(state: State<'_, crate::AppState>) -> Result<WorkerStatus, String> {
    let status = state
        .status
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone();
    Ok(status)
}

/// Tauri command: start the worker via `docker compose up -d`.
#[tauri::command]
pub async fn start_worker(state: State<'_, crate::AppState>) -> Result<ActionResult, String> {
    let project_dir = state.config.project_dir.clone();

    let result = tokio::process::Command::new("docker")
        .args(["compose", "up", "-d"])
        .current_dir(&project_dir)
        .env("PATH", EXEC_PATH)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => Ok(ActionResult {
            ok: true,
            error: None,
        }),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Ok(ActionResult {
                ok: false,
                error: Some(stderr),
            })
        }
        Err(e) => Ok(ActionResult {
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}

/// Tauri command: stop the worker via `docker compose down`.
#[tauri::command]
pub async fn stop_worker(state: State<'_, crate::AppState>) -> Result<ActionResult, String> {
    let project_dir = state.config.project_dir.clone();

    let result = tokio::process::Command::new("docker")
        .args(["compose", "down"])
        .current_dir(&project_dir)
        .env("PATH", EXEC_PATH)
        .output()
        .await;

    match result {
        Ok(output) if output.status.success() => Ok(ActionResult {
            ok: true,
            error: None,
        }),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Ok(ActionResult {
                ok: false,
                error: Some(stderr),
            })
        }
        Err(e) => Ok(ActionResult {
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}
