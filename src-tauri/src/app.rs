use crate::commands::archive as archive_commands;
use crate::commands::files as files_commands;
use crate::commands::habits as habits_commands;
use crate::commands::labels as labels_commands;
use crate::commands::projects as projects_commands;
use crate::commands::schemes as schemes_commands;
use crate::commands::settings as settings_commands;
use crate::commands::study as study_commands;
use crate::commands::window as window_commands;
use crate::core::archive::category_dir;
use crate::core::classify::{ClassifierChain, ExtensionClassifier};
use crate::core::events::StabilityParams;
use crate::core::ignore::IgnoreMatcher;
use crate::core::index::IndexStore;
use crate::core::path::normalize_path;
use crate::core::project::managed_unit_roots;
use crate::core::scan::{ScanEvent, ScanEventSink, ScanParams};
use crate::core::study_classify::{SharedStudyClassifier, StudyClassifier};
use crate::core::watched::dedupe_watched;
use crate::infra::archive_service::ArchiveService;
use crate::infra::index_store::SqliteIndexStore;
use crate::infra::logging::FileLogger;
use crate::infra::scanner::ScanService;
use crate::infra::storage;
use crate::infra::study_store::{JsonStudyStore, StudyStore};
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

/// 重算系统托管区（单元根 + 归档根）并同步到监听/扫描/自动归档服务，
/// 同时把历史已索引的托管区文件一次性标为 deleted（幂等）。
pub fn refresh_managed_state(app: &AppHandle) -> Result<(), String> {
    let settings = storage::load_settings(app);
    let mut roots = managed_unit_roots(&settings.watched_dirs, &settings.project_dirs);
    if !settings.archive_root.is_empty() {
        roots.push(normalize_path(&settings.archive_root));
    }
    if let Some(service) = app.try_state::<Mutex<crate::infra::watcher::WatchService>>() {
        service
            .lock()
            .map_err(|e| e.to_string())?
            .update_skip_roots(roots.clone());
    }
    if let Some(service) = app.try_state::<Mutex<crate::infra::scanner::ScanService>>() {
        service
            .lock()
            .map_err(|e| e.to_string())?
            .update_skip_roots(roots.clone());
    }
    if let Some(service) = app.try_state::<Mutex<ArchiveService>>() {
        service
            .lock()
            .map_err(|e| e.to_string())?
            .update(settings.archive_root.clone(), settings.auto_archive);
    }
    let store = app.state::<Arc<Mutex<dyn IndexStore>>>();
    let removed = store
        .lock()
        .map_err(|e| e.to_string())?
        .mark_under_roots_deleted(&roots)?;
    if removed > 0 {
        log::info!("unit: 排除 roots={} count={removed}", roots.len());
    }
    Ok(())
}

/// 解析 `--open-project <path>` 启动参数并执行打开（单实例与首次启动共用）。
fn open_project_from_args(app: &AppHandle, args: &[String]) {
    if let Some(pos) = args.iter().position(|a| a == "--open-project") {
        if let Some(path) = args.get(pos + 1) {
            match projects_commands::open_project(app.clone(), path.clone()) {
                Ok(outcome) => {
                    log::info!(
                        "project: 启动参数打开 {} opened_with={}",
                        path,
                        outcome.opened_with
                    );
                    let _ = app.emit("project-open", path.clone());
                }
                Err(e) => log::warn!("project: 启动参数打开失败 {e}"),
            }
        }
    }
}

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
        // 单实例：重复启动时唤起已有窗口并处理 --open-project 参数
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let _ = window_lifecycle::ensure_main_window(app);
            open_project_from_args(app, &args);
        }))
        // 文件/目录默认程序打开与资源管理器定位（ShellExecuteW）
        .plugin(tauri_plugin_opener::init())
        // 设置持久化存储
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            archive_commands::archive_files,
            archive_commands::archive_filtered,
            archive_commands::archive_project,
            archive_commands::undo_archive,
            archive_commands::list_archive_batches,
            settings_commands::get_settings,
            settings_commands::set_settings,
            settings_commands::reset_settings,
            study_commands::get_study_data,
            study_commands::save_study_data,
            study_commands::study_store_exists,
            study_commands::reapply_study_labels,
            schemes_commands::list_schemes,
            schemes_commands::save_scheme,
            schemes_commands::rename_scheme,
            schemes_commands::delete_scheme,
            habits_commands::get_habits,
            habits_commands::save_habits,
            labels_commands::list_label_defs,
            labels_commands::save_label_def,
            labels_commands::delete_label_def,
            files_commands::add_watched_dir,
            files_commands::remove_watched_dir,
            files_commands::list_watched_dirs,
            files_commands::query_files,
            files_commands::list_labels,
            files_commands::list_categories,
            files_commands::list_classify_defaults,
            files_commands::scan_all,
            files_commands::get_scan_status,
            files_commands::cancel_scan,
            files_commands::get_log_dir,
            files_commands::log_event,
            projects_commands::list_projects,
            projects_commands::add_project_dir,
            projects_commands::remove_project_dir,
            projects_commands::open_project,
            projects_commands::open_project_from_file,
            projects_commands::open_file,
            projects_commands::reveal_in_explorer,
            projects_commands::create_project_shortcut,
            projects_commands::list_detected_tools,
            projects_commands::open_url,
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

            // 学业数据与课程分类器：保存后刷新同一份共享状态
            let study_store = JsonStudyStore::new(data_dir.join("study.json"));
            let study_data = study_store.load();
            let mut study_classifier = StudyClassifier::new();
            study_classifier.refresh(&study_data);
            let study_classifier = Arc::new(Mutex::new(study_classifier));
            app.manage(study_classifier.clone());

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
            let classifier = Arc::new(ClassifierChain::new(vec![
                Box::new(ExtensionClassifier::with_overrides(&overrides))
                    as Box<dyn crate::core::classify::Classifier>,
                Box::new(SharedStudyClassifier(study_classifier)),
            ]));
            let emit_handle = app.handle().clone();
            let skip_roots: Vec<String> = {
                let mut roots = managed_unit_roots(&settings.watched_dirs, &settings.project_dirs);
                if !settings.archive_root.is_empty() {
                    roots.push(normalize_path(&settings.archive_root));
                }
                roots
            };
            let removed = store
                .lock()
                .map_err(|e| e.to_string())?
                .mark_under_roots_deleted(&skip_roots)?;
            if removed > 0 {
                log::info!("unit: 排除 roots={} count={removed}", skip_roots.len());
            }
            let app_for_auto = app.handle().clone();
            let mut service = WatchService::new(
                store.clone(),
                classifier.clone(),
                ignore_matcher.clone(),
                StabilityParams::default(),
                move |records| {
                    let _ = emit_handle.emit("files-changed", records.clone());
                    let settings = storage::load_settings(&app_for_auto);
                    if settings.auto_archive && !settings.archive_root.is_empty() {
                        let service_state = app_for_auto.state::<Mutex<ArchiveService>>();
                        let service_guard = service_state.lock();
                        if let Ok(service) = service_guard {
                            for record in records {
                                if record.state == "indexed"
                                    && category_dir(&record.labels) != "other"
                                {
                                    service.enqueue(record.path);
                                }
                            }
                        }
                    }
                },
            )
            .map_err(|e| format!("监听服务创建失败: {e}"))?;
            service.update_skip_roots(skip_roots.clone());
            let archive_service = ArchiveService::new(
                store.clone(),
                settings.archive_root.clone(),
                settings.auto_archive,
            );
            app.manage(Mutex::new(archive_service));
            app.state::<Mutex<ArchiveService>>()
                .lock()
                .map_err(|e| e.to_string())?
                .start();
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
                scan_service.update_skip_roots(skip_roots);
                for dir in &settings.watched_dirs {
                    scan_service.enqueue(dir.clone());
                }
                let mut scan_service = scan_service;
                scan_service.start();
            }
            log::info!("扫描服务已启动");

            tray::init(app)?;

            refresh_managed_state(app.handle())?;

            // 首次启动携带 --open-project 时，在服务就绪后执行打开
            let args: Vec<String> = std::env::args().collect();
            if args.iter().any(|a| a == "--open-project") {
                open_project_from_args(app.handle(), &args);
            }
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
