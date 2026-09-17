//! 规则方案命令：列表 / 保存（按 id upsert）/ 原子应用 / 重命名 / 删除。
//!
//! 「应用方案」为后端原子命令（0.8.8 命令面收紧）：由后端读方案并经
//! `settings_io` 单入口写入，消除「前端读 schemes.json 再 patch 设置」的
//! 规则双真相分叉。需要前端分支处理的错误以 `code|message` 前缀返回。
use crate::core::schemes::{valid_name, RuleScheme};
use crate::core::settings::{ClassifyRule, IgnoreRules};
use crate::infra::scheme_store::{JsonSchemeStore, SchemeStore};
use crate::infra::settings_io;
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

/// 保存方案：`id` 缺省新建；提供 `id` 时按 id upsert（更新规则内容，
/// 名称以 rename 为准不随之变化）。名称查重排除自身。
#[tauri::command]
pub fn save_scheme(
    app: AppHandle,
    id: Option<String>,
    name: String,
    ignore_rules: IgnoreRules,
    classify_overrides: Vec<ClassifyRule>,
) -> Result<RuleScheme, String> {
    let name = name.trim().to_string();
    if !valid_name(&name) {
        return Err("无效的方案名称".to_string());
    }
    let store = store(&app)?;
    let scheme = match id {
        Some(id) => {
            let mut existing = store
                .list()
                .into_iter()
                .find(|s| s.id == id)
                .ok_or_else(|| "scheme.not_found|方案不存在".to_string())?;
            existing.ignore_rules = ignore_rules;
            existing.classify_overrides = classify_overrides;
            if !existing.is_valid() {
                return Err("方案规则无效".to_string());
            }
            store.update(existing.clone())?;
            existing
        }
        None => {
            let scheme = RuleScheme {
                id: new_scheme_id(),
                name: name.clone(),
                ignore_rules,
                classify_overrides,
            };
            if !scheme.is_valid() {
                return Err("方案规则无效".to_string());
            }
            store.save(scheme.clone())?;
            scheme
        }
    };
    log::info!("schemes: 保存 \"{}\" ({})", scheme.name, scheme.id);
    Ok(scheme)
}

/// 原子应用方案：后端读方案内容并经设置单入口写入（0.8.8 消除规则双真相）。
#[tauri::command]
pub fn apply_scheme(app: AppHandle, id: String) -> Result<(), String> {
    let scheme = store(&app)?
        .list()
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "scheme.not_found|方案不存在".to_string())?;
    settings_io::modify_settings(&app, &["ignore_rules", "classify_overrides"], |settings| {
        settings.ignore_rules = scheme.ignore_rules.clone();
        settings.classify_overrides = scheme.classify_overrides.clone();
        Ok(())
    })?;
    log::info!("schemes: 应用 \"{}\" -> 设置", scheme.name);
    Ok(())
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
