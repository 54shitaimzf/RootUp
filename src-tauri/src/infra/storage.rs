use crate::core::settings::Settings;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

/// 读取设置；文件不存在或数据损坏时回落到默认值。
pub fn load_settings(app: &AppHandle) -> Settings {
    if let Ok(dir) = app.path().app_config_dir() {
        if let Err(e) = backup_corrupt_settings(&dir) {
            log::warn!("settings: 损坏备份失败: {e}");
        }
    }
    let store = match app.store(SETTINGS_FILE) {
        Ok(store) => store,
        Err(e) => {
            log::warn!("settings: 无法打开设置存储，回退默认值: {e}");
            let mut settings = Settings::default();
            settings.migrate();
            return settings;
        }
    };
    let mut settings: Settings = store
        .get(SETTINGS_KEY)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    settings.migrate();
    settings
}

/// 写入设置并立即落盘。
pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    store.set(SETTINGS_KEY, value);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// 检测并备份损坏的设置文件：解析失败且文件存在时改名为 `settings.corrupt-<时间戳>.bak`。
pub fn backup_corrupt_settings(dir: impl AsRef<Path>) -> Result<Option<PathBuf>, String> {
    let settings_path = dir.as_ref().join(SETTINGS_FILE);
    if !settings_path.exists() {
        return Ok(None);
    }
    let readable = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .is_some();
    if readable {
        return Ok(None);
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup = dir
        .as_ref()
        .join(format!("{SETTINGS_FILE}.corrupt-{ts}.bak"));
    std::fs::rename(&settings_path, &backup).map_err(|e| e.to_string())?;
    log::warn!("settings: 损坏备份 -> {}", backup.display());
    Ok(Some(backup))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_storage_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_settings_is_not_backed_up() {
        let dir = temp_dir("missing");
        assert_eq!(backup_corrupt_settings(&dir).unwrap(), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn valid_settings_is_not_backed_up() {
        let dir = temp_dir("valid");
        fs::write(dir.join(SETTINGS_FILE), r#"{"settings":{}}"#).unwrap();
        assert_eq!(backup_corrupt_settings(&dir).unwrap(), None);
        assert!(dir.join(SETTINGS_FILE).exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_settings_is_backed_up_and_renamed() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(SETTINGS_FILE), "{ 这不是合法 JSON").unwrap();
        let backup = backup_corrupt_settings(&dir).unwrap().expect("应生成备份");
        assert!(backup.exists());
        assert!(!dir.join(SETTINGS_FILE).exists());
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("settings.json.corrupt-"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
