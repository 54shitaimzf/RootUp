//! 启动门控：非关键服务（监听/扫描/自动归档/托盘）延迟到前端就绪后再启动。
use crate::core::index::IndexStore;
use crate::core::path::path_key;
use crate::infra::archive_service::ArchiveService;
use crate::infra::scanner::ScanService;
use crate::infra::storage;
use crate::infra::tray;
use crate::infra::usn_delta;
use crate::infra::watcher::WatchService;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// 延迟服务启动门控（幂等）。
pub struct StartupGate(pub Arc<AtomicBool>);

impl StartupGate {
    pub fn mark_started(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

/// 后台注册单个监控目录的监视器（运行期「添加监控目录」命令使用）。
///
/// 大目录递归注册可能阻塞数秒，命令线程只负责设置写入与扫描入队，
/// 注册在独立线程执行；注册前复检设置仍包含该目录（防与移除竞态），
/// 失败记日志不打断命令（`watched_dirs_overview` 的 exists 与重扫可兜底）。
pub fn spawn_register_watch(app: &AppHandle, dir: String) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("rootup-watch-register".into())
        .spawn(move || register_watch_dir(&app, &dir))
        .ok();
}

fn register_watch_dir(app: &AppHandle, dir: &str) {
    let still_watched = storage::load_settings(app)
        .watched_dirs
        .iter()
        .any(|d| path_key(d) == path_key(dir));
    if !still_watched {
        log::info!("watch: 注册跳过（等待窗口内已移除） {dir}");
        return;
    }
    let outcome = app
        .state::<Mutex<WatchService>>()
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|service| service.add_dir(dir));
    if let Err(e) = outcome {
        log::warn!("watch: 注册监听失败 {dir}: {e}");
    }
}

/// 启动监听、扫描、自动归档与托盘（幂等，只执行一次）。
///
/// 监视器目录注册（0.8.8 可靠性加固）：从 setup 阶段移入此处——先启动
/// 事件处理线程，再在后台线程逐目录递归注册，消除大目录（10k/20k 子目录）
/// 下 4–8 秒的启动阻塞；注册期间扫描可并行进行。
pub fn start_deferred_services(app: &AppHandle) -> Result<(), String> {
    let gate = app.state::<StartupGate>();
    if !gate.mark_started() {
        return Ok(());
    }
    let started = std::time::Instant::now();
    app.state::<Mutex<ArchiveService>>()
        .lock()
        .map_err(|e| e.to_string())?
        .start();
    app.state::<Mutex<WatchService>>()
        .lock()
        .map_err(|e| e.to_string())?
        .start();
    // 监视器注册后台化：批量注册所有监控目录（每个复检设置成员资格）
    let register_app = app.clone();
    let watched = storage::load_settings(app).watched_dirs;
    std::thread::Builder::new()
        .name("rootup-watch-register".into())
        .spawn(move || {
            let t0 = std::time::Instant::now();
            let total = watched.len();
            for dir in &watched {
                register_watch_dir(&register_app, dir);
            }
            log::info!(
                "startup: 监视器注册完成 count={total} ms={}",
                t0.elapsed().as_millis()
            );
        })
        .ok();
    app.state::<Mutex<ScanService>>()
        .lock()
        .map_err(|e| e.to_string())?
        .start();
    tray::init(app).map_err(|e| e.to_string())?;
    // USN 启动补账：后台线程执行，失败只记录不阻塞
    let catchup_app = app.clone();
    std::thread::Builder::new()
        .name("rootup-usn-catchup".into())
        .spawn(move || {
            let store = catchup_app.state::<Arc<Mutex<dyn IndexStore>>>();
            let store = store.inner().clone();
            let watched = storage::load_settings(&catchup_app).watched_dirs;
            match usn_delta::run_usn_catchup(store, &watched) {
                Ok((applied, deleted)) => {
                    log::info!("usn: 补账完成 applied={applied} deleted={deleted}");
                }
                Err(e) => log::warn!("usn: 补账失败 {e}"),
            }
        })
        .ok();
    // 项目单元同步：后台执行（units 的派生数据，失败不影响功能）
    let sync_app = app.clone();
    std::thread::Builder::new()
        .name("rootup-project-sync".into())
        .spawn(move || {
            crate::infra::project_sync::schedule_project_sync(&sync_app);
        })
        .ok();
    // 软件单元同步：后台执行（识别结果派生写入，失败不影响功能）
    crate::infra::software_sync::schedule_software_sync(app);
    // 启动对账与清理（0.8.8 可靠性加固）：后台执行，磁盘真源修复索引 + 清理强杀残留
    let reconcile_app = app.clone();
    std::thread::Builder::new()
        .name("rootup-startup-reconcile".into())
        .spawn(move || {
            let store = reconcile_app.state::<Arc<Mutex<dyn IndexStore>>>();
            let store = store.inner().clone();
            match crate::infra::startup_reconcile::reconcile_archive_ops(&store, 50) {
                Ok(summary) => {
                    log::info!(
                        "reconcile: 归档对账 checked={} fixed={} anomaly={}",
                        summary.checked,
                        summary.fixed,
                        summary.anomaly
                    );
                }
                Err(e) => log::warn!("reconcile: 归档对账失败 {e}"),
            }
            let mut dirs = Vec::new();
            if let Ok(dir) = reconcile_app.path().app_config_dir() {
                dirs.push(dir);
            }
            if let Ok(dir) = reconcile_app.path().app_data_dir() {
                dirs.push(dir);
            }
            crate::infra::startup_reconcile::cleanup_tmp_json(&dirs);
        })
        .ok();
    log::info!(
        "startup: 延迟服务已启动 ms={}",
        started.elapsed().as_millis()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_is_idempotent() {
        let gate = StartupGate(Arc::new(AtomicBool::new(false)));
        assert!(gate.mark_started());
        assert!(!gate.mark_started());
    }
}
