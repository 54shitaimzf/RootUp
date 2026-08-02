//! 文件监听、索引、扫描与查询相关命令。
use crate::core::classify::Category;
use crate::core::index::{FileRecord, IndexStore};
use crate::core::path::{normalize_path, path_key};
use crate::core::query::{parse_query, QueryPage};
use crate::core::watched::{check_add, AddCheck};
use crate::infra::scanner::{ScanService, ScanStatus};
use crate::infra::storage;
use crate::infra::watcher::WatchService;
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

const DEFAULT_LIST_LIMIT: i64 = 50;

/// 添加监控目录的结果（可能携带提示消息）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDirOutcome {
    pub message: Option<String>,
}

/// 添加监控目录：两向防重叠校验 → 持久化 → 启动监听 → 入队扫描。
#[tauri::command]
pub fn add_watched_dir(app: AppHandle, dir: String) -> Result<AddDirOutcome, String> {
    let dir = normalize_path(&dir);
    if dir.is_empty() {
        return Err("目录不能为空".into());
    }
    if !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }

    let mut settings = storage::load_settings(&app);
    let message = match check_add(&dir, &settings.watched_dirs) {
        AddCheck::Duplicate => {
            return Ok(AddDirOutcome {
                message: Some("目录已在监控中".into()),
            });
        }
        AddCheck::CoveredBy(parent) => {
            return Err(format!("该目录已被 {parent} 覆盖，无需重复添加"));
        }
        AddCheck::WillCover(children) => {
            for child in &children {
                if let Ok(service) = app.state::<Mutex<WatchService>>().lock() {
                    if let Err(e) = service.remove_dir(child) {
                        log::warn!("watch: 移除被覆盖目录 {child} 失败: {e}");
                    }
                }
                if let Ok(scanner) = app.state::<Mutex<ScanService>>().lock() {
                    scanner.remove_dir(child);
                }
                log::info!("watch: 升级覆盖 {child} -> {dir}");
            }
            settings
                .watched_dirs
                .retain(|d| !children.iter().any(|c| path_key(c) == path_key(d)));
            Some(format!(
                "已监控 {dir}，升级覆盖 {} 个原目录",
                children.len()
            ))
        }
        AddCheck::Ok => None,
    };

    settings.watched_dirs.push(dir.clone());
    storage::save_settings(&app, &settings)?;

    let service = app.state::<Mutex<WatchService>>();
    service.lock().map_err(|e| e.to_string())?.add_dir(&dir)?;

    let scanner = app.state::<Mutex<ScanService>>();
    scanner
        .lock()
        .map_err(|e| e.to_string())?
        .enqueue(dir.clone());
    log::info!("watch: 添加 {dir}");
    Ok(AddDirOutcome { message })
}

/// 移除监控目录：先更新设置，再取消监听与扫描队列。
#[tauri::command]
pub fn remove_watched_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = normalize_path(&dir);
    let mut settings = storage::load_settings(&app);
    settings
        .watched_dirs
        .retain(|d| path_key(d) != path_key(&dir));
    storage::save_settings(&app, &settings)?;

    let service = app.state::<Mutex<WatchService>>();
    if let Ok(service) = service.lock() {
        if let Err(e) = service.remove_dir(&dir) {
            log::warn!("commands: 取消监听 {dir} 失败（设置已移除）: {e}");
        }
    }
    if let Ok(scanner) = app.state::<Mutex<ScanService>>().lock() {
        scanner.remove_dir(&dir);
    }
    log::info!("watch: 移除 {dir}");
    Ok(())
}

/// 当前监控目录列表。
#[tauri::command]
pub fn list_watched_dirs(app: AppHandle) -> Vec<String> {
    storage::load_settings(&app).watched_dirs
}

fn run_query(
    store: &Mutex<dyn IndexStore>,
    query: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<QueryPage, String> {
    let started = Instant::now();
    let raw = query.unwrap_or("");
    let mut parsed = parse_query(raw);
    parsed.limit = limit.clamp(1, 1000);
    parsed.offset = offset.max(0);
    let store = store.lock().map_err(|e| e.to_string())?;
    let page = store.query(&parsed)?;
    let ms = started.elapsed().as_millis();
    log::info!("query: q=\"{raw}\" results={} ms={ms}", page.total);
    Ok(page)
}

/// 结构化查询（搜索语法 + 分页 + 总数）。
#[tauri::command]
pub fn query_files(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<QueryPage, String> {
    run_query(
        &store,
        query.as_deref(),
        limit.unwrap_or(DEFAULT_LIST_LIMIT),
        offset.unwrap_or(0),
    )
}

/// 兼容旧调用：返回记录列表（无总数）。
#[tauri::command]
pub fn list_files(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<FileRecord>, String> {
    let page = run_query(&store, query.as_deref(), limit.unwrap_or(200), 0)?;
    Ok(page.items)
}

/// 库中现存标签 key 列表（筛选器多选用）。
#[tauri::command]
pub fn list_labels(store: State<'_, Arc<Mutex<dyn IndexStore>>>) -> Result<Vec<String>, String> {
    store.lock().map_err(|e| e.to_string())?.list_labels()
}

/// 静态类别 key 列表（筛选 Chips 与图标映射的单一来源）。
#[tauri::command]
pub fn list_categories() -> Vec<String> {
    Category::ALL.iter().map(|c| c.key().to_string()).collect()
}

/// 全部监控目录入队扫描。
#[tauri::command]
pub fn scan_all(app: AppHandle) -> Result<(), String> {
    let settings = storage::load_settings(&app);
    let scanner = app.state::<Mutex<ScanService>>();
    let scanner = scanner.lock().map_err(|e| e.to_string())?;
    for dir in &settings.watched_dirs {
        scanner.enqueue(dir.clone());
    }
    log::info!("scan: 全部入队 dirs={}", settings.watched_dirs.len());
    Ok(())
}

/// 重新扫描指定监控目录。
#[tauri::command]
pub fn scan_now(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = normalize_path(&dir);
    let settings = storage::load_settings(&app);
    if !settings
        .watched_dirs
        .iter()
        .any(|d| path_key(d) == path_key(&dir))
    {
        return Err("目录未在监控列表中".into());
    }
    let scanner = app.state::<Mutex<ScanService>>();
    scanner.lock().map_err(|e| e.to_string())?.enqueue(dir);
    Ok(())
}

/// 当前扫描状态。
#[tauri::command]
pub fn get_scan_status(app: AppHandle) -> ScanStatus {
    app.state::<Mutex<ScanService>>()
        .lock()
        .map(|s| s.status())
        .unwrap_or_default()
}

/// 取消当前扫描。
#[tauri::command]
pub fn cancel_scan(app: AppHandle) {
    if let Ok(scanner) = app.state::<Mutex<ScanService>>().lock() {
        scanner.cancel();
        log::info!("scan: 取消请求");
    }
}

/// 日志目录路径（设置页展示，便于排查）。
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// 前端日志入口：前端错误统一进入后端日志系统。
#[tauri::command]
pub fn log_event(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[frontend] {message}"),
        "warn" => log::warn!("[frontend] {message}"),
        "debug" => log::debug!("[frontend] {message}"),
        _ => log::info!("[frontend] {message}"),
    }
}
