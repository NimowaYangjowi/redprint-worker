mod config;
mod db;
mod docker;
mod git;
mod tray;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub config: config::AppConfig,
    pub status: Arc<Mutex<docker::WorkerStatus>>,
    pub git_status: Arc<Mutex<git::GitStatus>>,
    pub db_pool: Arc<Mutex<Option<sqlx::PgPool>>>,
}

#[tauri::command]
async fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // ─── Config ──────────────────────────────────────────────
            let config = config::AppConfig::load();
            println!("[Monitor] project_dir: {:?}", config.project_dir);
            println!("[Monitor] git_project_dir: {:?}", config.git_project_dir);

            // ─── Shared state ────────────────────────────────────────
            let status = Arc::new(Mutex::new(docker::WorkerStatus::default()));
            let git_status = Arc::new(Mutex::new(git::GitStatus::new(
                &config.git_project_dir.to_string_lossy(),
                &config.git_project_label,
                &["dev", "main"],
            )));
            let db_pool: Arc<Mutex<Option<sqlx::PgPool>>> = Arc::new(Mutex::new(None));

            app.manage(AppState {
                config: config.clone(),
                status: status.clone(),
                git_status: git_status.clone(),
                db_pool: db_pool.clone(),
            });

            // ─── Tray ────────────────────────────────────────────────
            tray::create_tray(app.handle())?;

            // ─── Window: blur → hide ─────────────────────────────────
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win.hide();
                    }
                });
            }

            // ─── Hide from Dock (macOS menubar-only app) ─────────────
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ─── DB init (async) ─────────────────────────────────────
            let db_url = config.database_url.clone();
            let db_pool_init = db_pool.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(url) = db_url {
                    match db::init_pool(&url).await {
                        Ok(pool) => {
                            *db_pool_init.lock().unwrap() = Some(pool);
                            println!("[Monitor] DB connected");
                        }
                        Err(e) => eprintln!("[Monitor] DB init failed: {e}"),
                    }
                } else {
                    eprintln!("[Monitor] DATABASE_URL not found in .env.worker");
                }
            });

            // ─── Docker + DB polling (every 5s) ─────────────────────
            let app_handle = app.handle().clone();
            let poll_config = config.clone();
            let poll_status = status.clone();
            let poll_db = db_pool.clone();
            tauri::async_runtime::spawn(async move {
                // Brief delay to let DB pool initialize
                tokio::time::sleep(Duration::from_secs(1)).await;

                loop {
                    // 1. Docker container state
                    let name = poll_config.container_name.clone();
                    let container_state = tokio::task::spawn_blocking(move || {
                        docker::get_container_state(&name)
                    })
                    .await
                    .unwrap_or_else(|_| "unknown".to_string());

                    // 2. DB job stats + backup stats
                    let (db_result, backup_result) = {
                        let pool_opt = poll_db.lock().unwrap().clone();
                        match pool_opt {
                            Some(pool) => {
                                let jobs = db::query_job_stats(&pool).await.ok();
                                let backup = db::query_backup_stats(&pool).await.ok();
                                (jobs, backup)
                            }
                            None => (None, None),
                        }
                    };

                    // 3. Update cached status
                    let snapshot = {
                        let mut s = poll_status.lock().unwrap();
                        s.container_state = container_state;
                        if let Some((completed, failed, current_job)) = db_result {
                            s.today_completed = completed;
                            s.today_failed = failed;
                            s.current_job = current_job
                                .map(|j| serde_json::to_value(&j).unwrap_or_default());
                            s.db_connected = true;
                        }
                        s.backup = backup_result;
                        s.last_updated = Some(Utc::now().to_rfc3339());
                        s.clone()
                    };

                    // 4. Update tray icon + push to frontend
                    tray::update_icon(&app_handle, &snapshot);
                    let _ = app_handle.emit("status-update", &snapshot);

                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            });

            // ─── Git Auto-Pull polling (every 5min) ──────────────────
            git::start_git_polling(
                app.handle().clone(),
                config.git_project_dir.clone(),
                vec!["dev".to_string(), "main".to_string()],
                git_status,
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            docker::get_status,
            docker::start_worker,
            docker::stop_worker,
            git::get_git_status,
            git::toggle_git_pull,
            git::pull_now,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Redprint Monitor");
}
