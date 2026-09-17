//! 回收站删除命令（0.8.8）：应用内删除统一移入系统回收站（可恢复），
//! 并记入变更日志（action_log，action=delete）。
//!
//! 安全前置与归档同源：命令层归属校验（require_owned）+ 软件组件整树保护
//! （software_guard，allow_software 风险确认放行）。
use crate::commands::archive::{require_owned, software_guard};
use crate::core::archive::ArchiveFailure;
use crate::core::error_codes::{coded, DELETE_FAILED, DELETE_LOCKED};
use crate::core::index::IndexStore;
use crate::core::path::normalize_path;
use crate::infra::time::now_millis;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

/// 删除结果：deleted 为移入回收站数量；failed 携带 code（delete.failed / delete.locked）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub deleted: usize,
    pub failed: Vec<ArchiveFailure>,
}

/// 把回收站错误映射为注册表错误码：占用/拒绝访问 → delete.locked，其余 → delete.failed。
fn trash_error_code(error: &trash::Error) -> &'static str {
    trash_error_code_msg(&error.to_string())
}

fn trash_error_code_msg(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("access")
        || lower.contains("denied")
        || lower.contains("busy")
        || lower.contains("占用")
        || lower.contains("拒绝")
    {
        DELETE_LOCKED
    } else {
        DELETE_FAILED
    }
}

/// 批量移入系统回收站：部分失败保留成功项；成功路径同步标记索引 deleted。
#[tauri::command]
pub fn delete_to_trash(
    app: AppHandle,
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    paths: Vec<String>,
    allow_software: Option<bool>,
) -> Result<DeleteOutcome, String> {
    if paths.is_empty() {
        return Err("没有选择文件".to_string());
    }
    let paths: Vec<String> = paths.into_iter().map(|p| normalize_path(&p)).collect();
    require_owned(&app, &paths)?;
    software_guard(&store, &paths, allow_software.unwrap_or(false))?;

    let mut outcome = DeleteOutcome {
        deleted: 0,
        failed: Vec::new(),
    };
    {
        let mut locked = store.lock().map_err(|e| e.to_string())?;
        for path in &paths {
            match trash::delete(path) {
                Ok(()) => {
                    if let Err(e) = locked.mark_deleted(path) {
                        log::warn!("delete: 索引标记失败 path={path} err={e}");
                    }
                    outcome.deleted += 1;
                }
                Err(e) => {
                    let code = trash_error_code(&e);
                    log::warn!("delete: 移入回收站失败 path={path} code={code} err={e}");
                    outcome.failed.push(ArchiveFailure {
                        path: path.clone(),
                        error: coded(code, e.to_string()),
                        phase: "delete".to_string(),
                        code: Some(code.to_string()),
                    });
                }
            }
        }
    }
    if outcome.deleted > 0 {
        let detail = format!(
            "count={}; first={}",
            outcome.deleted,
            paths.first().map(String::as_str).unwrap_or("")
        );
        if let Err(e) = store.lock().map_err(|e| e.to_string())?.log_action(
            "delete",
            &detail,
            None,
            now_millis(),
        ) {
            log::warn!("delete: 变更日志写入失败 {e}");
        }
    }
    log::info!(
        "delete: 回收站删除 deleted={} failed={}",
        outcome.deleted,
        outcome.failed.len()
    );
    Ok(outcome)
}

/// 变更日志列表（0.8.8 变更日志 v1）：最近 limit 条（≤200）。
#[tauri::command]
pub fn list_actions(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    limit: i64,
) -> Result<Vec<crate::core::index::ActionEntry>, String> {
    store.lock().map_err(|e| e.to_string())?.list_actions(limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trash_error_code_maps_lock_and_failure() {
        assert_eq!(trash_error_code_msg("Access is denied"), DELETE_LOCKED);
        assert_eq!(trash_error_code_msg("文件被另一进程占用"), DELETE_LOCKED);
        assert_eq!(trash_error_code_msg("no such file"), DELETE_FAILED);
        assert_eq!(
            crate::core::error_codes::code_of(&coded(
                trash_error_code_msg("Access is denied"),
                "x"
            )),
            Some(DELETE_LOCKED)
        );
    }
}
