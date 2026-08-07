use crate::core::settings::{archive_root_conflicts, reset_to_default, Settings};
use crate::infra::managed_state;
use crate::infra::storage;
use crate::infra::tray;
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
    let mut settings = settings;
    settings.normalize();
    if !settings.is_valid() {
        return Err("无效的设置值".to_string());
    }
    if archive_root_conflicts(&settings) {
        return Err("归档根目录不能与监控目录相同".to_string());
    }
    log::info!(
        "settings: 更新 theme={} language={} rules={} overrides={}",
        settings.theme,
        settings.language,
        settings.ignore_rules.extensions.len(),
        settings.classify_overrides.len()
    );
    storage::save_settings(&app, &settings)?;
    managed_state::refresh(&app)?;
    let _ = tray::refresh_tray(&app);
    Ok(())
}

/// 恢复默认设置（保留监控目录），返回新设置供前端同步。
#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<Settings, String> {
    let current = storage::load_settings(&app);
    let reset = reset_to_default(&current);
    storage::save_settings(&app, &reset)?;
    managed_state::refresh(&app)?;
    let _ = tray::refresh_tray(&app);
    log::info!(
        "settings: 恢复默认（保留监控目录 {} 个）",
        reset.watched_dirs.len()
    );
    Ok(reset)
}
