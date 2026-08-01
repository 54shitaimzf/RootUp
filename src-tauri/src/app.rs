use crate::commands::files as files_commands;
use crate::commands::settings as settings_commands;
use crate::commands::window as window_commands;
use crate::core::events::StabilityParams;
use crate::core::index::IndexStore;
use crate::infra::index_store::SqliteIndexStore;
use crate::infra::logging::FileLogger;
use crate::infra::storage;
use crate::infra::tray;
use crate::infra::watcher::WatchService;
use crate::infra::window as window_lifecycle;
use log::LevelFilter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// 主动退出标志。
///
/// Tauri 默认在最后一个窗口销毁时触发 `RunEvent::ExitRequested` 并退出进程，
/// 这会让"后台运行（关闭即销毁）"失效。因此事件循环中默认阻止退出，
/// 仅当用户明确选择退出（托盘菜单 / 确认弹窗）并先置位此标志时才放行。
pub struct QuitFlag(pub Arc<AtomicBool>);

pub fn run() {
    tauri::Builder::default()
        // 单实例：重复启动时唤起已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = window_lifecycle::ensure_main_window(app);
        }))
        // 设置持久化存储
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            settings_commands::get_settings,
            settings_commands::set_settings,
            files_commands::add_watched_dir,
            files_commands::remove_watched_dir,
            files_commands::list_watched_dirs,
            files_commands::list_files,
            files_commands::log_event,
            window_commands::hide_to_tray,
            window_commands::quit_app,
        ])
        .manage(QuitFlag(Arc::new(AtomicBool::new(false))))
        // 关闭请求：拦截并通知前端弹出确认弹窗，由用户决定后台运行或退出
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .setup(|app| {
            // 日志系统：文件日志 + 终端镜像（debug）
            let log_dir = app
                .path()
                .app_log_dir()
                .map_err(|e| format!("无法获取日志目录: {e}"))?;
            let logger = FileLogger::init(log_dir, LevelFilter::Info)
                .map_err(|e| format!("日志初始化失败: {e}"))?;
            let logger = Box::leak(Box::new(logger));
            let _ = log::set_logger(logger);
            log::set_max_level(LevelFilter::Info);
            log::info!("RootUp 启动");

            // 文件索引库
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法获取数据目录: {e}"))?;
            let store: Arc<Mutex<dyn IndexStore>> = Arc::new(Mutex::new(
                SqliteIndexStore::open(data_dir.join("rootup.db"))
                    .map_err(|e| format!("索引库打开失败: {e}"))?,
            ));
            app.manage(store.clone());
            log::info!("索引库就绪: {:?}", data_dir.join("rootup.db"));

            // 文件监听服务：事件批次广播到前端
            let emit_handle = app.handle().clone();
            let mut service =
                WatchService::new(store, StabilityParams::default(), move |records| {
                    let _ = emit_handle.emit("files-changed", records);
                })
                .map_err(|e| format!("监听服务创建失败: {e}"))?;
            let settings = storage::load_settings(app.handle());
            for dir in &settings.watched_dirs {
                if let Err(e) = service.add_dir(dir) {
                    log::warn!("watch: 无法监听 {dir}: {e}");
                }
            }
            service.start();
            app.manage(Mutex::new(service));
            log::info!("监听服务已启动（{} 个目录）", settings.watched_dirs.len());

            tray::init(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("RootUp 启动失败")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<QuitFlag>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
