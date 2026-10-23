mod market_data;

use market_data::{fetch_indices, fetch_quotes, fetch_trend, search_assets};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

fn trading_ledger_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("trading-ledger.json"))
        .map_err(|error| format!("无法定位交易账本目录: {error}"))
}

#[tauri::command]
fn load_trading_ledger(app: AppHandle) -> Result<Option<String>, String> {
    let target = trading_ledger_path(&app)?;
    if !target.exists() {
        return Ok(None);
    }
    match fs::read_to_string(&target) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) => {
            let backup = target.with_extension("json.bak");
            if backup.exists() {
                fs::read_to_string(&backup)
                    .map(Some)
                    .map_err(|backup_error| {
                        format!("读取交易账本失败: {error}; 备份读取失败: {backup_error}")
                    })
            } else {
                Err(format!("读取交易账本失败: {error}"))
            }
        }
    }
}

#[tauri::command]
fn save_trading_ledger(app: AppHandle, contents: String) -> Result<(), String> {
    if contents.len() > 8 * 1024 * 1024 {
        return Err("交易账本超过 8 MiB，已拒绝写入".to_string());
    }
    let target = trading_ledger_path(&app)?;
    let parent = target
        .parent()
        .ok_or_else(|| "交易账本路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建交易账本目录失败: {error}"))?;
    if target.exists() {
        let backup = target.with_extension("json.bak");
        fs::copy(&target, &backup).map_err(|error| format!("备份交易账本失败: {error}"))?;
    }
    write_trading_ledger(&target, &contents)
}

fn write_trading_ledger(target: &Path, contents: &str) -> Result<(), String> {
    let temporary = target.with_extension("json.tmp");
    fs::write(&temporary, contents).map_err(|error| format!("写入临时交易账本失败: {error}"))?;
    if target.exists() {
        fs::remove_file(target).map_err(|error| format!("替换交易账本失败: {error}"))?;
    }
    fs::rename(&temporary, target).map_err(|error| format!("提交交易账本失败: {error}"))
}

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
            load_trading_ledger,
            save_trading_ledger,
            show_compact_window,
            hide_compact_window,
            focus_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run 简盯");
}
