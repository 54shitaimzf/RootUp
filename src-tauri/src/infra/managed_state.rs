//! 托管状态刷新：把「单元根 + 归档根」同步到监听/扫描/自动归档服务，并清理历史索引。
//!
//! 该模块是 Tauri 适配层的一部分，负责在设置变化或启动时统一重算跳过集；
//! 命令层与托盘只依赖这里，不反向依赖组合根 `app.rs`。
use crate::core::index::IndexStore;
use crate::core::path::normalize_path;
use crate::core::project::managed_unit_roots;
use crate::infra::archive_service::ArchiveService;
use crate::infra::scanner::ScanService;
use crate::infra::storage;
use crate::infra::watcher::WatchService;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// 重算系统托管区（单元根 + 归档根）并同步到监听/扫描/自动归档服务，
/// 同时把历史已索引的托管区文件一次性标为 deleted（幂等）。
pub fn refresh(app: &AppHandle) -> Result<(), String> {
    let settings = storage::load_settings(app);
    let mut roots = managed_unit_roots(&settings.watched_dirs, &settings.project_dirs);
    if !settings.archive_root.is_empty() {
        roots.push(normalize_path(&settings.archive_root));
    }
    if let Some(service) = app.try_state::<Mutex<WatchService>>() {
        service
            .lock()
            .map_err(|e| e.to_string())?
            .update_skip_roots(roots.clone());
    }
    if let Some(service) = app.try_state::<Mutex<ScanService>>() {
        service
            .lock()
            .map_err(|e| e.to_string())?
            .update_skip_roots(roots.clone());
    }
    if let Some(service) = app.try_state::<Mutex<ArchiveService>>() {
        service
            .lock()
            .map_err(|e| e.to_string())?
            .update(settings.archive_root.clone(), settings.auto_archive);
    }
    let store = app.state::<Arc<Mutex<dyn IndexStore>>>();
    let removed = store
        .lock()
        .map_err(|e| e.to_string())?
        .mark_under_roots_deleted(&roots)?;
    if removed > 0 {
        log::info!("unit: 排除 roots={} count={removed}", roots.len());
    }
    Ok(())
}
