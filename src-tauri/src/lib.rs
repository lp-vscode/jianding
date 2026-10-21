mod market_data;

use market_data::{fetch_indices, fetch_quotes, fetch_trend, search_assets};
use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

fn place_compact_window(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let main_monitor = app
        .get_webview_window("main")
        .map(|main| main.current_monitor())
        .transpose()
        .map_err(|error| format!("无法读取主窗口所在显示器: {error}"))?
        .flatten();
    let monitor = if let Some(monitor) = main_monitor {
        Some(monitor)
    } else {
        window
            .primary_monitor()
            .map_err(|error| format!("无法读取显示器信息: {error}"))?
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = monitor.work_area();
    let size = window
        .outer_size()
        .map_err(|error| format!("无法读取浮窗尺寸: {error}"))?;
    let margin = (18.0 * monitor.scale_factor()).round() as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + margin;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("无法定位浮窗: {error}"))
}

#[tauri::command]
fn show_compact_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("compact") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, "compact", WebviewUrl::App("index.html".into()))
        .title("简盯 · 浮窗")
        .inner_size(420.0, 264.0)
        .min_inner_size(380.0, 230.0)
        .resizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|error| format!("无法创建浮窗: {error}"))?;
    place_compact_window(&app, &window)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_compact_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("compact") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn focus_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    if let Some(compact) = app.get_webview_window("compact") {
        compact.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::Focused(true)) {
                if let Some(compact) = window.app_handle().get_webview_window("compact") {
                    let _ = compact.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            fetch_quotes,
            search_assets,
            fetch_trend,
            fetch_indices,
            show_compact_window,
            hide_compact_window,
            focus_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run 简盯");
}
