use crate::core::settings::{reset_to_default, Settings};
use crate::infra::storage;
use tauri::AppHandle;

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

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    if !settings.is_valid() {
        return Err("无效的设置值".to_string());
    }
    log::info!(
        "settings: 更新 theme={} language={} rules={} overrides={}",
        settings.theme,
        settings.language,
        settings.ignore_rules.extensions.len(),
        settings.classify_overrides.len()
    );
    storage::save_settings(&app, &settings)
}

/// 恢复默认设置（保留监控目录），返回新设置供前端同步。
#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<Settings, String> {
    let current = storage::load_settings(&app);
    let reset = reset_to_default(&current);
    storage::save_settings(&app, &reset)?;
    log::info!(
        "settings: 恢复默认（保留监控目录 {} 个）",
        reset.watched_dirs.len()
    );
    Ok(reset)
}
