//! 设置写入单入口：所有对 settings.json 的修改必须经本模块互斥执行，
//! 写后统一 refresh 内存缓存并广播 settings-changed（载荷为变更字段名）。
//!
//! 背景：写路径曾有命令 / 托盘 / 归档 journal 多处各自 load→改→save，
//! 互不感知且不发事件，前端只能拿快照补偿，产生「旧快照覆盖丢字段」类 bug。
use crate::core::archive_guard::assess_archive_root;
use crate::core::events::{SettingsChangedEvent, EVENT_SETTINGS_CHANGED};
use crate::core::settings::{archive_root_conflicts, Settings};
use crate::infra::managed_state;
use crate::infra::storage;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// 进程内设置写入互斥锁：消灭多写路径的读改写竞态。
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 单一写入口：互斥地 load → mutate → validate → save → refresh → emit。
///
/// `mutate` 在锁内执行，可安全读改 settings（如 add_watched_dir 的升级覆盖复检）；
/// 返回 Err 则整体放弃写入。`dirty` 为本次变更的 serde 字段名（事件载荷）。
pub fn modify_settings<F>(app: &AppHandle, dirty: &[&str], mutate: F) -> Result<Settings, String>
where
    F: FnOnce(&mut Settings) -> Result<(), String>,
{
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| "设置写入锁不可用".to_string())?;
    let mut settings = storage::load_settings(app);
    mutate(&mut settings)?;
    settings.normalize();
    if !settings.is_valid() {
        return Err("无效的设置值".to_string());
    }
    if archive_root_conflicts(&settings) {
        return Err("归档根目录不能与监控目录相同".to_string());
    }
    // 归档根安全拦截只在本次显式改动 archive_root 时执行：存量违规配置
    // （如盘根）不锁死其他字段的写入，用户主动换位置时才被拦下并引导。
    guard_archive_root_dirty(dirty, &settings.archive_root)?;
    save_locked_inner(app, &settings, dirty)?;
    Ok(settings)
}

/// 在写入锁内保存调用方已改好的 settings 并广播（journal 等快照写路径使用）。
pub fn save_locked(app: &AppHandle, settings: &Settings, dirty: &[&str]) -> Result<(), String> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| "设置写入锁不可用".to_string())?;
    save_locked_inner(app, settings, dirty)
}

/// 归档根安全拦截：仅当本次 dirty 含 `archive_root` 且新值被评估为 blocked
/// 时拒绝（结构化错误码 `archive_guard.blocked|<reason>`，前端映射 i18n）。
/// warn / safe 放行——warn 级的二次确认由前端负责。
pub fn guard_archive_root_dirty(dirty: &[&str], archive_root: &str) -> Result<(), String> {
    if !dirty.contains(&"archive_root") {
        return Ok(());
    }
    let check = assess_archive_root(archive_root);
    if check.level == "blocked" {
        let reason = check.reason.unwrap_or_else(|| "protected_tree".to_string());
        return Err(format!("archive_guard.blocked|{reason}"));
    }
    Ok(())
}

/// 锁内落盘 + 缓存刷新 + 事件广播；调用方必须已持有 [`SETTINGS_WRITE_LOCK`]。
fn save_locked_inner(app: &AppHandle, settings: &Settings, dirty: &[&str]) -> Result<(), String> {
    storage::save_settings(app, settings)?;
    managed_state::refresh(app)?;
    let _ = app.emit(
        EVENT_SETTINGS_CHANGED,
        SettingsChangedEvent {
            keys: dirty.iter().map(|key| (*key).to_string()).collect(),
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_archive_root_rejected_only_when_dirty() {
        // 显式改归档根为盘根：拒绝并携带结构化错误码
        let err = guard_archive_root_dirty(&["archive_root"], "D:/").unwrap_err();
        assert!(
            err.starts_with("archive_guard.blocked|"),
            "结构化前缀: {err}"
        );
        assert_eq!(err, "archive_guard.blocked|drive_root");

        // 同样的存量盘根配置，但本次只改主题：放行（不锁死其他字段写入）
        guard_archive_root_dirty(&["theme"], "D:/").unwrap();

        // warn / safe 级放行（warn 的二次确认由前端负责）
        guard_archive_root_dirty(&["archive_root"], "C:/Users/X/Desktop").unwrap();
        guard_archive_root_dirty(&["archive_root"], "C:/Users/X/Documents/RootUp 档案库").unwrap();
    }
}
