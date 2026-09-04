use crate::core::settings::{reset_to_default, Settings, SettingsPatch};
use crate::infra::settings_io;
use crate::infra::storage;
use crate::infra::tray;
use tauri::AppHandle;

/// 恢复默认时被重置的字段（watched_dirs / project_dirs 有意保留）。
const RESET_DIRTY: &[&str] = &[
    "theme",
    "language",
    "ignore_rules",
    "classify_overrides",
    "preferred_ide",
    "custom_open_commands",
    "archive_root",
    "auto_archive",
    "close_action",
    "reminder_enabled",
    "reminder_lead_days",
];

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let settings = storage::load_settings(&app);
    log::info!(
        "settings: 加载 theme={} language={} watched={}",
        settings.theme,
        settings.language,
        settings.watched_dirs.len()
    );
    settings
}

/// 增量更新设置：`None` 字段保持不变，合并结果整体校验后经单入口原子落盘。
/// watched_dirs / project_dirs 不在补丁内——必须走 add/remove 专用命令（防快照覆盖）。
#[tauri::command]
pub fn update_settings(app: AppHandle, patch: SettingsPatch) -> Result<(), String> {
    let keys = patch.dirty_keys();
    settings_io::modify_settings(&app, &keys, |settings| {
        settings.apply_patch(patch);
        Ok(())
    })?;
    let _ = tray::refresh_tray(&app);
    log::info!("settings: 增量更新 {:?}", keys);
    Ok(())
}

/// 恢复默认设置（保留监控目录 / 项目目录），返回新设置供前端同步。
#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<Settings, String> {
    let reset = settings_io::modify_settings(&app, RESET_DIRTY, |settings| {
        *settings = reset_to_default(settings);
        Ok(())
    })?;
    let _ = tray::refresh_tray(&app);
    log::info!(
        "settings: 恢复默认（保留监控目录 {} 个）",
        reset.watched_dirs.len()
    );
    Ok(reset)
}
