use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::config::EXEC_PATH;

// ─── Structs ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitBranchState {
    pub state: String,
    pub last_pull: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitStatus {
    pub enabled: bool,
    pub repo_path: String,
    pub repo_label: String,
    pub last_checked: Option<String>,
    pub last_error: Option<String>,
    pub branches: HashMap<String, GitBranchState>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PullResult {
    pub ok: bool,
    pub error: Option<String>,
    pub pulled: Vec<String>,
    pub unchanged: Vec<String>,
}

// ─── GitStatus impl ─────────────────────────────────────────────────────────

impl GitStatus {
    pub fn new(repo_path: &str, repo_label: &str, branches: &[&str]) -> Self {
        let mut branch_map = HashMap::new();
        for &b in branches {
            branch_map.insert(
                b.to_string(),
                GitBranchState {
                    state: "unknown".to_string(),
                    last_pull: None,
                },
            );
        }
        Self {
            enabled: true,
            repo_path: repo_path.to_string(),
            repo_label: repo_label.to_string(),
            last_checked: None,
            last_error: None,
            branches: branch_map,
        }
    }
}

// ─── Private helpers ────────────────────────────────────────────────────────

fn git_run(repo_dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("/usr/bin/git")
        .arg("-C")
        .arg(repo_dir)
        .args(args)
        .env("PATH", EXEC_PATH)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn fetch_branches(repo_dir: &Path, branches: &[&str]) -> Result<(), String> {
    let mut args = vec!["fetch", "origin"];
    args.extend_from_slice(branches);
    git_run(repo_dir, &args)?;
    Ok(())
}

fn branch_needs_sync(
    repo_dir: &Path,
    branch: &str,
    current_branch: &str,
) -> Result<bool, String> {
    let local = git_run(repo_dir, &["rev-parse", branch])?;
    let remote_ref = format!("origin/{branch}");
    let remote = git_run(repo_dir, &["rev-parse", &remote_ref])?;

    if local != remote {
        return Ok(true);
    }

    // Same commit — check if current worktree is dirty
    if branch == current_branch {
        let porcelain = git_run(
            repo_dir,
            &["status", "--porcelain", "--untracked-files=all"],
        )?;
        if !porcelain.is_empty() {
            return Ok(true);
        }
    }

    Ok(false)
}

fn sync_branch(
    repo_dir: &Path,
    branch: &str,
    current_branch: &str,
) -> Result<(), String> {
    if current_branch == branch {
        let reset_target = format!("origin/{branch}");
        git_run(repo_dir, &["reset", "--hard", &reset_target])?;
        git_run(repo_dir, &["clean", "-fd"])?;
    } else {
        let refspec = format!("+refs/heads/{branch}:refs/heads/{branch}");
        git_run(repo_dir, &["fetch", "origin", &refspec])?;
    }
    Ok(())
}

// ─── Poll logic ─────────────────────────────────────────────────────────────

/// Performs one polling cycle: fetch, compare, and sync branches.
/// Keeps the desktop monitor app's branch sync behavior consistent across builds.
pub fn poll_git(repo_dir: &Path, branches: &[&str], git_status: &Mutex<GitStatus>) {
    // Check if enabled (lock briefly, then release)
    {
        let status = git_status.lock().unwrap();
        if !status.enabled {
            return;
        }
    }

    let now = Utc::now().to_rfc3339();

    // Fetch all tracked branches from origin
    if let Err(e) = fetch_branches(repo_dir, branches) {
        let mut status = git_status.lock().unwrap();
        status.last_checked = Some(now);
        status.last_error = Some(e);
        for b in branches {
            if let Some(bs) = status.branches.get_mut(*b) {
                bs.state = "error".to_string();
            }
        }
        return;
    }

    // Fetch succeeded
    {
        let mut status = git_status.lock().unwrap();
        status.last_checked = Some(now);
        status.last_error = None;
    }

    // Determine which branch is currently checked out
    let current_branch = match git_run(repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(b) => b,
        Err(e) => {
            let mut status = git_status.lock().unwrap();
            status.last_error = Some(e);
            for b in branches {
                if let Some(bs) = status.branches.get_mut(*b) {
                    bs.state = "error".to_string();
                }
            }
            return;
        }
    };

    // Check and sync each branch individually
    for &branch in branches {
        let result: Result<bool, String> = (|| {
            if !branch_needs_sync(repo_dir, branch, &current_branch)? {
                return Ok(false);
            }
            sync_branch(repo_dir, branch, &current_branch)?;
            Ok(true)
        })();

        let mut status = git_status.lock().unwrap();
        match result {
            Ok(true) => {
                status.branches.insert(
                    branch.to_string(),
                    GitBranchState {
                        state: "pulled".to_string(),
                        last_pull: Some(Utc::now().to_rfc3339()),
                    },
                );
            }
            Ok(false) => {
                if let Some(bs) = status.branches.get_mut(branch) {
                    bs.state = "up-to-date".to_string();
                }
            }
            Err(e) => {
                status.last_error = Some(e);
                if let Some(bs) = status.branches.get_mut(branch) {
                    bs.state = "error".to_string();
                }
            }
        }
    }
}

// ─── Polling loop ───────────────────────────────────────────────────────────

/// Spawns a background task that polls git every 5 minutes.
/// Runs an immediate poll on startup, then loops with a 300-second interval.
/// After each poll, emits a `"git-status-update"` event to the frontend.
pub fn start_git_polling(
    app_handle: AppHandle,
    repo_dir: PathBuf,
    branches: Vec<String>,
    git_status: Arc<Mutex<GitStatus>>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            let repo = repo_dir.clone();
            let br = branches.clone();
            let status_ref = git_status.clone();

            // Run blocking git commands on a dedicated thread
            let _ = tokio::task::spawn_blocking(move || {
                let branch_refs: Vec<&str> = br.iter().map(|s| s.as_str()).collect();
                poll_git(&repo, &branch_refs, &status_ref);
            })
            .await;

            // Emit updated status to the frontend
            {
                let status = git_status.lock().unwrap();
                let _ = app_handle.emit("git-status-update", status.clone());
            }

            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_git_status(state: State<'_, crate::AppState>) -> GitStatus {
    state.git_status.lock().unwrap().clone()
}

#[tauri::command]
pub async fn toggle_git_pull(
    enabled: bool,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<GitStatus, String> {
    // Update the enabled flag
    {
        let mut status = state.git_status.lock().unwrap();
        status.enabled = enabled;
    }

    // Emit so frontend reflects the toggle immediately
    {
        let snapshot = state.git_status.lock().unwrap().clone();
        let _ = app_handle.emit("git-status-update", snapshot);
    }

    // If re-enabling, trigger an immediate poll
    if enabled {
        let repo_dir = state.config.git_project_dir.clone();
        let branches: Vec<String> = {
            let status = state.git_status.lock().unwrap();
            status.branches.keys().cloned().collect()
        };
        let git_status_clone = state.git_status.clone();

        tokio::task::spawn_blocking(move || {
            let branch_refs: Vec<&str> = branches.iter().map(|s| s.as_str()).collect();
            poll_git(&repo_dir, &branch_refs, &git_status_clone);
        })
        .await
        .map_err(|e| format!("poll task failed: {e}"))?;

        let snapshot = state.git_status.lock().unwrap().clone();
        let _ = app_handle.emit("git-status-update", snapshot.clone());
        Ok(snapshot)
    } else {
        Ok(state.git_status.lock().unwrap().clone())
    }
}

#[tauri::command]
pub async fn pull_now(
    branch: Option<String>,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<PullResult, String> {
    let repo_dir = state.config.git_project_dir.clone();

    let target_branches: Vec<String> = match &branch {
        Some(b) => vec![b.clone()],
        None => {
            let status = state.git_status.lock().unwrap();
            status.branches.keys().cloned().collect()
        }
    };

    let git_status_clone = state.git_status.clone();
    let branches_for_task = target_branches.clone();

    let result = tokio::task::spawn_blocking(move || {
        do_pull_now(&repo_dir, &branches_for_task, &git_status_clone)
    })
    .await
    .map_err(|e| format!("pull task failed: {e}"))?;

    // Emit updated status to frontend
    let snapshot = state.git_status.lock().unwrap().clone();
    let _ = app_handle.emit("git-status-update", snapshot);

    Ok(result)
}

/// Performs an immediate fetch+sync for the given branches.
/// Returns a `PullResult` describing what happened.
fn do_pull_now(
    repo_dir: &Path,
    branches: &[String],
    git_status: &Mutex<GitStatus>,
) -> PullResult {
    let branch_refs: Vec<&str> = branches.iter().map(|s| s.as_str()).collect();

    // Fetch
    if let Err(e) = fetch_branches(repo_dir, &branch_refs) {
        let now = Utc::now().to_rfc3339();
        let mut status = git_status.lock().unwrap();
        status.last_checked = Some(now);
        status.last_error = Some(e.clone());
        return PullResult {
            ok: false,
            error: Some(e),
            pulled: vec![],
            unchanged: vec![],
        };
    }

    {
        let now = Utc::now().to_rfc3339();
        let mut status = git_status.lock().unwrap();
        status.last_checked = Some(now);
        status.last_error = None;
    }

    // Get current branch
    let current_branch = match git_run(repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(b) => b,
        Err(e) => {
            let mut status = git_status.lock().unwrap();
            status.last_error = Some(e.clone());
            return PullResult {
                ok: false,
                error: Some(e),
                pulled: vec![],
                unchanged: vec![],
            };
        }
    };

    let mut pulled = Vec::new();
    let mut unchanged = Vec::new();

    for b in &branch_refs {
        let needs = match branch_needs_sync(repo_dir, b, &current_branch) {
            Ok(v) => v,
            Err(e) => {
                let mut status = git_status.lock().unwrap();
                status.last_error = Some(e);
                if let Some(bs) = status.branches.get_mut(*b) {
                    bs.state = "error".to_string();
                }
                continue;
            }
        };

        if !needs {
            let mut status = git_status.lock().unwrap();
            if let Some(bs) = status.branches.get_mut(*b) {
                bs.state = "up-to-date".to_string();
            }
            unchanged.push(b.to_string());
            continue;
        }

        match sync_branch(repo_dir, b, &current_branch) {
            Ok(()) => {
                let mut status = git_status.lock().unwrap();
                status.branches.insert(
                    b.to_string(),
                    GitBranchState {
                        state: "pulled".to_string(),
                        last_pull: Some(Utc::now().to_rfc3339()),
                    },
                );
                pulled.push(b.to_string());
            }
            Err(e) => {
                let mut status = git_status.lock().unwrap();
                status.last_error = Some(e);
                if let Some(bs) = status.branches.get_mut(*b) {
                    bs.state = "error".to_string();
                }
            }
        }
    }

    PullResult {
        ok: true,
        error: None,
        pulled,
        unchanged,
    }
}
