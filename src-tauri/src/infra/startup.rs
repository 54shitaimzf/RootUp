//! 启动门控：非关键服务（监听/扫描/自动归档/托盘）延迟到前端就绪后再启动。
use crate::core::index::IndexStore;
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

/// 启动监听、扫描、自动归档与托盘（幂等，只执行一次）。
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
