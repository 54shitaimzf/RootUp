//! 文件监听与索引相关命令。

use crate::core::index::{FileRecord, IndexStore};
use crate::infra::storage;
use crate::infra::watcher::WatchService;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const DEFAULT_LIST_LIMIT: i64 = 200;

/// 添加监控目录：校验存在性 → 启动监听 → 持久化设置。
#[tauri::command]
pub fn add_watched_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let path = Path::new(&dir);
    if !path.is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }

    let service = app.state::<Mutex<WatchService>>();
    let service = service.lock().map_err(|e| e.to_string())?;
    service.add_dir(&dir)?;

    let mut settings = storage::load_settings(&app);
    if !settings.watched_dirs.contains(&dir) {
        settings.watched_dirs.push(dir);
        storage::save_settings(&app, &settings)?;
        log::info!("commands: 已添加监控目录并持久化");
    }
    Ok(())
}

/// 移除监控目录：先更新设置，取消监听失败仅告警（目录可能已被删除）。
#[tauri::command]
pub fn remove_watched_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let mut settings = storage::load_settings(&app);
    settings.watched_dirs.retain(|d| d != &dir);
    storage::save_settings(&app, &settings)?;

    let service = app.state::<Mutex<WatchService>>();
    let service = service.lock().map_err(|e| e.to_string())?;
    if let Err(e) = service.remove_dir(&dir) {
        log::warn!("commands: 取消监听 {dir} 失败（设置已移除）: {e}");
    }
    Ok(())
}

/// 当前监控目录列表。
#[tauri::command]
pub fn list_watched_dirs(app: AppHandle) -> Vec<String> {
    storage::load_settings(&app).watched_dirs
}

/// 文件索引列表：可选按名称搜索，默认最近 200 条。
#[tauri::command]
pub fn list_files(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<FileRecord>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, 1000);
    match query {
        Some(q) if !q.trim().is_empty() => store.search(q.trim(), limit),
        _ => store.list(limit, 0),
    }
}

/// 前端日志入口：前端错误统一进入后端日志系统。
#[tauri::command]
pub fn log_event(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[frontend] {message}"),
        "warn" => log::warn!("[frontend] {message}"),
        "debug" => log::debug!("[frontend] {message}"),
        _ => log::info!("[frontend] {message}"),
    }
}
