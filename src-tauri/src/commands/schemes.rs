//! 规则方案命令：列表 / 保存 / 重命名 / 删除。
//!
//! “应用方案”在前端完成：读取方案内容后走 `update_settings` 增量命令，
//! 后端不提供专门命令，避免与设置写入路径分叉。
//! 需要前端分支处理的错误以 `code|message` 前缀返回（错误码注册表最小切片）。
use crate::core::schemes::{valid_name, RuleScheme};
use crate::core::settings::{ClassifyRule, IgnoreRules};
use crate::infra::scheme_store::{JsonSchemeStore, SchemeStore};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static ID_SEQ: AtomicU64 = AtomicU64::new(0);

fn new_scheme_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("scheme-{ms}-{seq}")
}

fn store(app: &AppHandle) -> Result<JsonSchemeStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("schemes: 无法获取数据目录: {e}"))?;
    Ok(JsonSchemeStore::new(dir.join("schemes.json")))
}

#[tauri::command]
pub fn list_schemes(app: AppHandle) -> Result<Vec<RuleScheme>, String> {
    Ok(store(&app)?.list())
}

#[tauri::command]
pub fn save_scheme(
    app: AppHandle,
    name: String,
    ignore_rules: IgnoreRules,
    classify_overrides: Vec<ClassifyRule>,
) -> Result<RuleScheme, String> {
    let name = name.trim().to_string();
    if !valid_name(&name) {
        return Err("无效的方案名称".to_string());
    }
    let scheme = RuleScheme {
        id: new_scheme_id(),
        name: name.clone(),
        ignore_rules,
        classify_overrides,
    };
    if !scheme.is_valid() {
        return Err("方案规则无效".to_string());
    }
    store(&app)?.save(scheme.clone())?;
    log::info!("schemes: 保存 \"{name}\"");
    Ok(scheme)
}

#[tauri::command]
pub fn rename_scheme(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if !valid_name(&name) {
        return Err("无效的方案名称".to_string());
    }
    store(&app)?.rename(&id, &name)?;
    log::info!("schemes: 重命名 {id} -> \"{name}\"");
    Ok(())
}

#[tauri::command]
pub fn delete_scheme(app: AppHandle, id: String) -> Result<(), String> {
    store(&app)?.delete(&id)?;
    log::info!("schemes: 删除 {id}");
    Ok(())
}
