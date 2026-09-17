//! 软件单元裁决命令：手动认定 / 排除软件目录（0.8.8 软件单元识别第一版）。
//!
//! 裁决持久化在 settings（software_dirs / software_excluded），识别结果由
//! software_sync 派生写入 units（kind=software）；两份清单变更后都触发后台重同步。
use crate::commands::files::AddDirOutcome;
use crate::core::path::{normalize_path, path_key, validate_dir_path};
use crate::infra::settings_io;
use crate::infra::software_sync::schedule_software_sync;
use std::path::Path;
use tauri::AppHandle;

/// 手动认定软件目录：写入 software_dirs 并从排除清单移除（裁决优先级最高）。
#[tauri::command]
pub fn add_software_dir(app: AppHandle, dir: String) -> Result<AddDirOutcome, String> {
    let dir = validate_dir_path(&dir)?;
    if !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }
    let mut message: Option<String> = None;
    settings_io::modify_settings(&app, &["software_dirs", "software_excluded"], |settings| {
        if settings
            .software_dirs
            .iter()
            .any(|d| path_key(d) == path_key(&dir))
        {
            message = Some("该目录已在软件列表中".into());
            return Ok(());
        }
        settings.software_dirs.push(dir.clone());
        // 认定与排除互斥：加入认定即解除排除
        settings
            .software_excluded
            .retain(|d| path_key(d) != path_key(&dir));
        Ok(())
    })?;
    log::info!("software: 认定 {dir}");
    schedule_software_sync(&app);
    Ok(AddDirOutcome { message, dir })
}

/// 取消手动认定：从 software_dirs 移除（识别依据命中时仍会以自动口径重识别）。
#[tauri::command]
pub fn remove_software_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = normalize_path(&dir);
    settings_io::modify_settings(&app, &["software_dirs"], |settings| {
        settings
            .software_dirs
            .retain(|d| path_key(d) != path_key(&dir));
        Ok(())
    })?;
    log::info!("software: 取消认定 {dir}");
    schedule_software_sync(&app);
    Ok(())
}

/// 排除软件目录：压制自动识别与手动认定（排除优先级最高）。
#[tauri::command]
pub fn exclude_software_dir(app: AppHandle, dir: String) -> Result<AddDirOutcome, String> {
    let dir = validate_dir_path(&dir)?;
    let mut message: Option<String> = None;
    settings_io::modify_settings(&app, &["software_dirs", "software_excluded"], |settings| {
        if settings
            .software_excluded
            .iter()
            .any(|d| path_key(d) == path_key(&dir))
        {
            message = Some("该目录已在排除列表中".into());
            return Ok(());
        }
        settings.software_excluded.push(dir.clone());
        // 排除与认定互斥：排除即移除认定
        settings
            .software_dirs
            .retain(|d| path_key(d) != path_key(&dir));
        Ok(())
    })?;
    log::info!("software: 排除 {dir}");
    schedule_software_sync(&app);
    Ok(AddDirOutcome { message, dir })
}

/// 解除排除。
#[tauri::command]
pub fn remove_software_exclusion(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = normalize_path(&dir);
    settings_io::modify_settings(&app, &["software_excluded"], |settings| {
        settings
            .software_excluded
            .retain(|d| path_key(d) != path_key(&dir));
        Ok(())
    })?;
    log::info!("software: 解除排除 {dir}");
    schedule_software_sync(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rejects_empty() {
        assert!(validate_dir_path("").is_err());
    }
}
