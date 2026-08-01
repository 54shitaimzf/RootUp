use crate::core::settings::Settings;
use crate::infra::storage;
use tauri::AppHandle;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    storage::load_settings(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    if !settings.is_valid() {
        return Err("无效的设置值".to_string());
    }
    storage::save_settings(&app, &settings)
}
