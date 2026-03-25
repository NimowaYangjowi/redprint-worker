use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::docker::WorkerStatus;

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray-stopped.png"))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Redprint Monitor")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_popup(app, position.x, position.y);
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_popup(app: &AppHandle, click_x: f64, click_y: f64) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    // Position window centered under the click point (physical coords)
    let scale = window.scale_factor().unwrap_or(1.0);
    let win_width = 300.0;
    let x = click_x / scale - win_width / 2.0;
    let y = click_y / scale + 4.0;
    let _ = window.set_position(tauri::Position::Logical(
        tauri::LogicalPosition::new(x, y),
    ));
    let _ = window.show();
    let _ = window.set_focus();

    // Push latest state to frontend — clone immediately to avoid lifetime issues
    let state = app.state::<crate::AppState>();
    let status = state.status.lock().unwrap().clone();
    let git = state.git_status.lock().unwrap().clone();
    let _ = app.emit("status-update", &status);
    let _ = app.emit("git-status-update", &git);
}

pub fn update_icon(app: &AppHandle, status: &WorkerStatus) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };

    let (icon_bytes, tooltip): (&[u8], String) = if status.container_state == "running"
        && status.current_job.is_some()
    {
        (
            include_bytes!("../icons/tray-active.png"),
            "Redprint Worker · 처리 중".to_string(),
        )
    } else if status.container_state == "running" {
        (
            include_bytes!("../icons/tray-idle.png"),
            "Redprint Worker · 대기 중".to_string(),
        )
    } else {
        (
            include_bytes!("../icons/tray-stopped.png"),
            format!("Redprint Worker · {}", status.container_state),
        )
    };

    if let Ok(icon) = Image::from_bytes(icon_bytes) {
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_icon_as_template(true);
    }
    let _ = tray.set_tooltip(Some(tooltip.as_str()));
}
