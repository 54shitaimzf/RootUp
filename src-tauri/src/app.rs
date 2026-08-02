use crate::commands::files as files_commands;
use crate::commands::settings as settings_commands;
use crate::commands::window as window_commands;
use crate::core::classify::{ClassifierChain, ExtensionClassifier};
use crate::core::events::StabilityParams;
use crate::core::ignore::IgnoreMatcher;
use crate::core::index::IndexStore;
use crate::core::scan::{ScanEvent, ScanEventSink, ScanParams};
use crate::core::watched::dedupe_watched;
use crate::infra::index_store::SqliteIndexStore;
use crate::infra::logging::FileLogger;
use crate::infra::scanner::ScanService;
use crate::infra::storage;
use crate::infra::tray;
use crate::infra::watcher::WatchService;
use crate::infra::window as window_lifecycle;
use log::LevelFilter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

/// 主动退出标志。
///
/// Tauri 默认在最后一个窗口销毁时触发 `RunEvent::ExitRequested` 并退出进程，
/// 这会让"后台运行（关闭即销毁）"失效。因此事件循环中默认阻止退出，
/// 仅当用户明确选择退出（托盘菜单 / 确认弹窗）并先置位此标志时才放行。
pub struct QuitFlag(pub Arc<AtomicBool>);

/// 扫描事件 → Tauri 前端事件（Progress → scan-progress，其余 → scan-finished）。
struct TauriScanSink {
    app: AppHandle,
}

impl ScanEventSink for TauriScanSink {
    fn on_event(&self, event: ScanEvent) {
        match &event {
            ScanEvent::Progress { .. } => {
                let _ = self.app.emit("scan-progress", event);
            }
            _ => {
                let _ = self.app.emit("scan-finished", event);
            }
        }
    }
}

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
            settings_commands::reset_settings,
            files_commands::add_watched_dir,
            files_commands::remove_watched_dir,
            files_commands::list_watched_dirs,
            files_commands::list_files,
            files_commands::query_files,
            files_commands::list_labels,
            files_commands::list_categories,
            files_commands::list_classify_defaults,
            files_commands::scan_all,
            files_commands::scan_now,
            files_commands::get_scan_status,
            files_commands::cancel_scan,
            files_commands::get_log_dir,
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

            // 监控目录：启动自愈（规范化 + 防重叠修正），修正结果写回设置
            let mut settings = storage::load_settings(app.handle());
            let (fixed_dirs, fixes) = dedupe_watched(&settings.watched_dirs);
            if !fixes.is_empty() {
                for (sub, parent) in &fixes {
                    log::info!("watch: 启动修正 {sub} -> {parent}");
                }
                settings.watched_dirs = fixed_dirs;
                storage::save_settings(app.handle(), &settings)?;
            }

            // 文件监听服务：事件批次广播到前端
            let extension_rules: Vec<&str> = settings
                .ignore_rules
                .extensions
                .iter()
                .map(String::as_str)
                .collect();
            let prefix_rules: Vec<&str> = settings
                .ignore_rules
                .prefixes
                .iter()
                .map(String::as_str)
                .collect();
            let exact_rules: Vec<&str> = settings
                .ignore_rules
                .exact_names
                .iter()
                .map(String::as_str)
                .collect();
            let ignore_matcher =
                IgnoreMatcher::from_rules(&extension_rules, &prefix_rules, &exact_rules);
            let overrides: Vec<(Vec<String>, String)> = settings
                .classify_overrides
                .iter()
                .map(|rule| (rule.extensions.clone(), rule.category.clone()))
                .collect();
            let classifier =
                Arc::new(ClassifierChain::new(vec![
                    Box::new(ExtensionClassifier::with_overrides(&overrides))
                        as Box<dyn crate::core::classify::Classifier>,
                ]));
            let emit_handle = app.handle().clone();
            let mut service = WatchService::new(
                store.clone(),
                classifier.clone(),
                ignore_matcher.clone(),
                StabilityParams::default(),
                move |records| {
                    let _ = emit_handle.emit("files-changed", records);
                },
            )
            .map_err(|e| format!("监听服务创建失败: {e}"))?;
            for dir in &settings.watched_dirs {
                if let Err(e) = service.add_dir(dir) {
                    log::warn!("watch: 无法监听 {dir}: {e}");
                }
            }
            service.start();
            app.manage(Mutex::new(service));
            log::info!("监听服务已启动（{} 个目录）", settings.watched_dirs.len());

            // 初始化扫描服务：后台全量扫描 + 快照差集 + 风暴保护
            let scan_service = ScanService::new(
                store,
                classifier,
                ignore_matcher,
                ScanParams::default(),
                Arc::new(TauriScanSink {
                    app: app.handle().clone(),
                }),
            );
            app.manage(Mutex::new(scan_service));
            let scan_service = app.state::<Mutex<ScanService>>();
            {
                let scan_service = scan_service.lock().map_err(|e| e.to_string())?;
                for dir in &settings.watched_dirs {
                    scan_service.enqueue(dir.clone());
                }
                let mut scan_service = scan_service;
                scan_service.start();
            }
            log::info!("扫描服务已启动");

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
