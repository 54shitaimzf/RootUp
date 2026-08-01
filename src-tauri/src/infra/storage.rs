use crate::core::settings::Settings;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

/// 读取设置；文件不存在或数据损坏时回落到默认值。
pub fn load_settings(app: &AppHandle) -> Settings {
    let store = app.store(SETTINGS_FILE).expect("无法打开设置存储");
    store
        .get(SETTINGS_KEY)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

/// 写入设置并立即落盘。
pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    store.set(SETTINGS_KEY, value);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
