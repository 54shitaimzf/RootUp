use crate::commands::archive as archive_commands;
use crate::commands::files as files_commands;
use crate::commands::habits as habits_commands;
use crate::commands::labels as labels_commands;
use crate::commands::projects as projects_commands;
use crate::commands::schemes as schemes_commands;
use crate::commands::settings as settings_commands;
use crate::commands::startup as startup_commands;
use crate::commands::study as study_commands;
use crate::commands::window as window_commands;
use crate::core::archive::category_dir;
use crate::core::classify::{ClassifierChain, ExtensionClassifier};
use crate::core::events::{
    FileState, StabilityParams, EVENT_CLOSE_REQUESTED, EVENT_FILES_CHANGED, EVENT_PROJECT_OPEN,
    EVENT_SCAN_FINISHED, EVENT_SCAN_PROGRESS, EVENT_STUDY_HOMEWORK_OPEN,
};
use crate::core::ignore::IgnoreMatcher;
use crate::core::index::{IndexStore, ScanDiffStore};
use crate::core::path::normalize_path;
use crate::core::project::managed_unit_roots;
use crate::core::scan::{ScanEvent, ScanEventSink, ScanParams};
use crate::core::study_classify::{SharedStudyClassifier, StudyClassifier};
use crate::core::watched::dedupe_watched;
use crate::infra::archive_service::ArchiveService;
use crate::infra::index_store::SqliteIndexStore;
use crate::infra::logging::FileLogger;
use crate::infra::scanner::ScanService;
use crate::infra::shortcut;
use crate::infra::startup::StartupGate;
use crate::infra::storage;
use crate::infra::study_store::{JsonStudyStore, StudyStore};
use crate::infra::watcher::WatchService;
use crate::infra::window as window_lifecycle;
use log::LevelFilter;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

/// 首次启动深链意图：网页监听器就绪前事件会丢失，改为暂存由前端主动领取。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StartupIntent {
    Project { path: String },
    Homework,
}

/// 解析启动参数为深链意图（--open-homework 优先，其次 --open-project）。
fn startup_intent_from_args(args: &[String]) -> Option<StartupIntent> {
    if args.iter().any(|a| a == "--open-homework") {
        return Some(StartupIntent::Homework);
    }
    if let Some(pos) = args.iter().position(|a| a == "--open-project") {
        if let Some(path) = args.get(pos + 1) {
            if valid_deep_link_path(path) {
                return Some(StartupIntent::Project { path: path.clone() });
            }
            log::warn!("startup: 忽略非法 --open-project 参数");
        }
    }
    None
}

/// 深链路径白名单式校验：非空、长度受限、无控制字符。
fn valid_deep_link_path(path: &str) -> bool {
    !path.trim().is_empty() && path.len() <= 1024 && !path.chars().any(|c| c.is_control())
}

/// 深链是否需要把 RootUp 调到前台：项目唤醒保持后台（不抢焦点），
/// 作业唤醒与普通启动照常聚焦。
fn startup_intent_focuses_window(intent: Option<&StartupIntent>) -> bool {
    !matches!(intent, Some(StartupIntent::Project { .. }))
}

/// 前端领取首次启动深链意图（领取后清空，单实例热唤起仍走事件）。
#[tauri::command]
pub fn take_startup_intent(
    state: tauri::State<'_, Mutex<Option<StartupIntent>>>,
) -> Option<StartupIntent> {
    let intent = state.lock().ok().and_then(|mut intent| intent.take());
    log::info!("startup: 前端领取意图 {:?}", intent);
    intent
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
                }
                Err(e) => log::warn!("project: 启动参数打开失败 {e}"),
            }
        }
    }
}

/// 单实例热唤起：前端监听器已就绪，直接事件通知。
fn emit_startup_intent(app: &AppHandle, args: &[String]) {
    match startup_intent_from_args(args) {
        Some(StartupIntent::Project { path }) => {
            let _ = app.emit(EVENT_PROJECT_OPEN, path);
        }
        Some(StartupIntent::Homework) => {
            let _ = app.emit(EVENT_STUDY_HOMEWORK_OPEN, Option::<String>::None);
            log::info!("study: 启动参数打开未完成作业");
        }
        None => {}
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
                let _ = self.app.emit(EVENT_SCAN_PROGRESS, event);
            }
            _ => {
                let _ = self.app.emit(EVENT_SCAN_FINISHED, event);
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        // 单实例：重复启动时唤起已有窗口并处理 --open-project 参数
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let intent = startup_intent_from_args(&args);
            if startup_intent_focuses_window(intent.as_ref()) {
                let _ = window_lifecycle::ensure_main_window(app);
            }
            open_project_from_args(app, &args);
            emit_startup_intent(app, &args);
        }))
        // 文件/目录默认程序打开与资源管理器定位（ShellExecuteW）
        .plugin(tauri_plugin_opener::init())
        // 设置持久化存储
        .plugin(tauri_plugin_store::Builder::default().build())
        // 原生目录选择器（添加监控目录“浏览…”）
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            archive_commands::archive_files,
            archive_commands::archive_filtered,
            archive_commands::archive_project,
            archive_commands::undo_archive,
            archive_commands::list_archive_batches,
            archive_commands::assess_archive_root,
            archive_commands::recommended_archive_roots,
            settings_commands::get_settings,
            settings_commands::update_settings,
            settings_commands::reset_settings,
            study_commands::get_study_data,
            study_commands::save_study_data,
            study_commands::study_store_exists,
            study_commands::reapply_study_labels,
            study_commands::course_overview,
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
            files_commands::count_under_root,
            files_commands::resolve_dir_target,
            files_commands::list_common_dirs,
            files_commands::list_watched_dirs,
            files_commands::watched_dir_health,
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
            projects_commands::create_homework_shortcut,
            projects_commands::list_detected_tools,
            projects_commands::open_url,
            window_commands::hide_to_tray,
            window_commands::quit_app,
            startup_commands::app_ready,
            take_startup_intent,
        ])
        .manage(window_lifecycle::QuitFlag(Arc::new(AtomicBool::new(false))))
        .manage(StartupGate(Arc::new(AtomicBool::new(false))))
        .manage(Mutex::new(None::<StartupIntent>))
        // 关闭请求：拦截并通知前端弹出确认弹窗，由用户决定后台运行或退出
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                let settings = storage::load_settings(app);
                match settings.close_action.as_str() {
                    crate::core::settings::CLOSE_ACTION_BACKGROUND => {
                        let _ = window_lifecycle::destroy_main_window(app);
                    }
                    crate::core::settings::CLOSE_ACTION_QUIT => {
                        app.state::<window_lifecycle::QuitFlag>()
                            .0
                            .store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {
                        let _ = window.emit(EVENT_CLOSE_REQUESTED, ());
                    }
                }
            }
        })
        .setup(|app| {
            let t0 = Instant::now();
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
            log::info!("startup: 日志就绪 ms={}", t0.elapsed().as_millis());
            let t0 = Instant::now();

            // 深链意图必须在 WebView 加载完成前就绪，否则前端领取时仍为 None
            let startup_args: Vec<String> = std::env::args().collect();
            if let Some(intent) = startup_intent_from_args(&startup_args) {
                let hide_window = !startup_intent_focuses_window(Some(&intent));
                *app.state::<Mutex<Option<StartupIntent>>>()
                    .lock()
                    .map_err(|e| e.to_string())? = Some(intent);
                log::info!("startup: 暂存深链意图");
                if hide_window {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                        log::info!("startup: 项目唤醒保持后台（窗口隐藏）");
                    }
                }
            }

            // 文件索引库
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法获取数据目录: {e}"))?;
            let sqlite_store = Arc::new(Mutex::new(
                SqliteIndexStore::open(data_dir.join("rootup.db"))
                    .map_err(|e| format!("索引库打开失败: {e}"))?,
            ));
            let store: Arc<Mutex<dyn IndexStore>> = sqlite_store.clone();
            let scan_store: Arc<Mutex<dyn ScanDiffStore>> = sqlite_store;
            app.manage(store.clone());
            log::info!("索引库就绪: {:?}", data_dir.join("rootup.db"));

            // 快捷图标对账：补齐内嵌图标并清理杂散缓存
            let icon_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("无法获取缓存目录: {e}"))?
                .join("shortcut-icons");
            shortcut::reconcile_shortcut_icons(&icon_dir)
                .map_err(|e| format!("快捷图标对账失败: {e}"))?;
            log::info!("startup: 图标对账 ms={}", t0.elapsed().as_millis());
            let t0 = Instant::now();

            // 学业数据与课程分类器：保存后刷新同一份共享状态
            let study_store = JsonStudyStore::new(data_dir.join("study.json"));
            let study_data = study_store.load();
            let mut study_classifier = StudyClassifier::new();
            study_classifier.refresh(&study_data);
            let study_classifier = Arc::new(Mutex::new(study_classifier));
            app.manage(study_classifier.clone());
            log::info!("startup: 学业数据 ms={}", t0.elapsed().as_millis());
            let t0 = Instant::now();

            // 监控目录：启动自愈（规范化 + 防重叠修正），修正结果写回设置。
            // 此处直写 storage：装配期 managed_state 未就绪，不能走 settings_io 单入口（会 refresh/emit）。
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
            let service = WatchService::new(
                store.clone(),
                classifier.clone(),
                ignore_matcher.clone(),
                StabilityParams::default(),
                move |records| {
                    let _ = emit_handle.emit(EVENT_FILES_CHANGED, records.clone());
                    // 热路径零磁盘 IO：自动归档开关与根目录由 managed_state::refresh
                    // 在设置变更时推送到 ArchiveService 缓存，这里只读内存状态。
                    let Some(archive_state) = app_for_auto.try_state::<Mutex<ArchiveService>>()
                    else {
                        return;
                    };
                    let Ok(service) = archive_state.lock() else {
                        return;
                    };
                    if !service.is_active() {
                        return;
                    }
                    for record in records {
                        if record.state == FileState::Indexed.as_str()
                            && category_dir(&record.labels) != "other"
                        {
                            service.enqueue(record.path);
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
            for dir in &settings.watched_dirs {
                if let Err(e) = service.add_dir(dir) {
                    log::warn!("watch: 无法监听 {dir}: {e}");
                }
            }
            app.manage(Mutex::new(service));
            log::info!(
                "监听服务已装配（{} 个目录，待前端就绪后启动）",
                settings.watched_dirs.len()
            );

            // 初始化扫描服务：后台全量扫描 + 快照差集 + 风暴保护
            let scan_service = ScanService::new(
                scan_store,
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
            }
            log::info!("startup: 服务装配 ms={}", t0.elapsed().as_millis());
            log::info!("扫描服务已装配（待前端就绪后启动）");

            // 非关键服务延迟到前端就绪；10 秒未就绪则回退启动，避免功能缺失
            let fallback_app = app.handle().clone();
            let gate = app.state::<StartupGate>().0.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if !gate.load(Ordering::SeqCst) {
                    log::warn!("startup: 前端就绪超时，回退启动延迟服务");
                    let _ = crate::infra::startup::start_deferred_services(&fallback_app);
                }
            });

            crate::infra::managed_state::refresh(app.handle())?;

            // 首次启动：项目打开照常执行（跳转由前端领取意图完成）
            if startup_args.iter().any(|a| a == "--open-project") {
                open_project_from_args(app.handle(), &startup_args);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("RootUp 启动失败")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !app
                    .state::<window_lifecycle::QuitFlag>()
                    .0
                    .load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_intent_parsing() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            startup_intent_from_args(&args(&["--open-project", "C:/x"])),
            Some(StartupIntent::Project {
                path: "C:/x".into()
            })
        );
        assert!(matches!(
            startup_intent_from_args(&args(&["--open-homework"])),
            Some(StartupIntent::Homework)
        ));
        assert_eq!(startup_intent_from_args(&args(&[])), None);
        assert_eq!(
            startup_intent_from_args(&args(&["--open-project", ""])),
            None
        );
        assert_eq!(
            startup_intent_from_args(&args(&["--open-project", "bad\npath"])),
            None
        );
        assert_eq!(
            startup_intent_from_args(&args(&["--open-project", "C:/ok"])),
            Some(StartupIntent::Project {
                path: "C:/ok".into()
            })
        );
        assert!(matches!(
            startup_intent_from_args(&args(&["--open-homework", "--open-project", "C:/x"])),
            Some(StartupIntent::Homework)
        ));
    }

    #[test]
    fn startup_intent_focus_matrix() {
        assert!(startup_intent_focuses_window(None));
        assert!(startup_intent_focuses_window(Some(
            &StartupIntent::Homework
        )));
        assert!(!startup_intent_focuses_window(Some(
            &StartupIntent::Project {
                path: "C:/x".into()
            }
        )));
    }
}
