//! 文件监听、索引、扫描与查询相关命令。
use crate::core::classify::{Category, DEFAULT_EXTENSION_MAP};
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key, validate_dir_path};
use crate::core::query::{parse_query, QueryPage};
use crate::core::watched::{check_add, AddCheck};
use crate::infra::managed_state;
use crate::infra::scanner::{ScanService, ScanStatus};
use crate::infra::storage;
use crate::infra::watcher::WatchService;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

const DEFAULT_LIST_LIMIT: i64 = 50;

/// 添加监控目录的结果（可能携带提示消息）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDirOutcome {
    pub message: Option<String>,
    pub dir: String,
}

/// 常用目录条目（下载 / 桌面 / 文档，仅返回存在项）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonDirEntry {
    pub path: String,
    pub kind: String,
}

/// 内置扩展名 → 类别映射条目（设置页只读展示用，单一来源在后端）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyDefaultEntry {
    pub extension: String,
    pub category: String,
}

/// 添加监控目录：两向防重叠校验 → 持久化 → 启动监听 → 入队扫描。
#[tauri::command]
pub fn add_watched_dir(app: AppHandle, dir: String) -> Result<AddDirOutcome, String> {
    let dir = validate_dir_path(&dir)?;
    if !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }

    let mut settings = storage::load_settings(&app);
    let message = match check_add(&dir, &settings.watched_dirs) {
        AddCheck::Duplicate => {
            return Ok(AddDirOutcome {
                message: Some("目录已在监控中".into()),
                dir: dir.clone(),
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
    managed_state::refresh(&app)?;

    let service = app.state::<Mutex<WatchService>>();
    service.lock().map_err(|e| e.to_string())?.add_dir(&dir)?;

    let scanner = app.state::<Mutex<ScanService>>();
    scanner
        .lock()
        .map_err(|e| e.to_string())?
        .enqueue(dir.clone());
    log::info!("watch: 添加 {dir}");
    Ok(AddDirOutcome { message, dir })
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
    managed_state::refresh(&app)?;

    let service = app.state::<Mutex<WatchService>>();
    if let Ok(service) = service.lock() {
        if let Err(e) = service.remove_dir(&dir) {
            log::warn!("commands: 取消监听 {dir} 失败（设置已移除）: {e}");
        }
    }
    if let Ok(scanner) = app.state::<Mutex<ScanService>>().lock() {
        scanner.remove_dir(&dir);
    }
    // 移除即清理：该目录（含子目录）下已索引记录标记 deleted（不动磁盘，可重扫恢复）。
    let store = app.state::<Arc<Mutex<dyn IndexStore>>>();
    let removed = store
        .lock()
        .map_err(|e| e.to_string())?
        .mark_under_roots_deleted(std::slice::from_ref(&dir))?;
    log::info!("watch: 移除 {dir} 清理索引 count={removed}");
    Ok(())
}

/// 某目录（含子目录）下非 deleted 的索引记录数（移除确认用）。
#[tauri::command]
pub fn count_under_root(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    root: String,
) -> Result<i64, String> {
    let root = normalize_path(&root);
    if root.is_empty() {
        return Err("目录不能为空".into());
    }
    store
        .lock()
        .map_err(|e| e.to_string())?
        .count_under_root(&root)
}

/// 拖拽/粘贴路径解析：目录原样返回；文件返回其父目录；不存在报错。
#[tauri::command]
pub fn resolve_dir_target(path: String) -> Result<String, String> {
    resolve_dir_target_inner(&path)
}

fn resolve_dir_target_inner(path: &str) -> Result<String, String> {
    let path = normalize_path(path);
    if path.is_empty() {
        return Err("路径不能为空".into());
    }
    let p = Path::new(&path);
    if p.is_dir() {
        return Ok(path);
    }
    if p.is_file() {
        let parent = p
            .parent()
            .map(|d| normalize_path(&d.to_string_lossy()))
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "无法确定父目录".to_string())?;
        return Ok(parent);
    }
    Err("路径不存在".into())
}

/// 从用户目录推导常用目录（仅返回存在项，按 下载→桌面→文档 排序）。
fn common_dirs_from(base: &Path) -> Vec<CommonDirEntry> {
    let candidates = [
        ("downloads", "Downloads"),
        ("desktop", "Desktop"),
        ("documents", "Documents"),
    ];
    let mut result = Vec::new();
    for (kind, name) in candidates {
        let path = base.join(name);
        if path.is_dir() {
            result.push(CommonDirEntry {
                path: normalize_path(&path.to_string_lossy()),
                kind: kind.to_string(),
            });
        }
    }
    result
}

/// 常用目录（下载 / 桌面 / 文档）一键添加候选。
#[tauri::command]
pub fn list_common_dirs() -> Vec<CommonDirEntry> {
    let Some(base) = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
    else {
        return Vec::new();
    };
    common_dirs_from(&base)
}

/// 当前监控目录列表。
#[tauri::command]
pub fn list_watched_dirs(app: AppHandle) -> Vec<String> {
    storage::load_settings(&app).watched_dirs
}

/// 监控目录健康状态（设置页缺失标记用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedDirHealth {
    pub dir: String,
    pub exists: bool,
}

#[tauri::command]
pub fn watched_dir_health(app: AppHandle) -> Vec<WatchedDirHealth> {
    storage::load_settings(&app)
        .watched_dirs
        .iter()
        .map(|dir| WatchedDirHealth {
            dir: dir.clone(),
            exists: Path::new(dir).is_dir(),
        })
        .collect()
}

// 参数即命令线契约（query/limit/offset/sort/cursor/need_total），保留平铺签名。
#[allow(clippy::too_many_arguments)]
fn run_query(
    store: &Mutex<dyn IndexStore>,
    query: Option<&str>,
    limit: i64,
    offset: i64,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    cursor: Option<String>,
    need_total: Option<bool>,
) -> Result<QueryPage, String> {
    let started = Instant::now();
    let raw = query.unwrap_or("");
    let mut parsed = parse_query(raw);
    if let Some(field) = sort_by {
        if !matches!(
            field.as_str(),
            "name" | "type" | "size" | "modified" | "labels"
        ) {
            return Err(format!("不支持的排序字段: {field}"));
        }
        parsed.sort_by = Some(field);
    }
    let dir = sort_dir.unwrap_or_else(|| "desc".into());
    if !matches!(dir.as_str(), "asc" | "desc") {
        return Err(format!("不支持的排序方向: {dir}"));
    }
    parsed.sort_dir = dir;
    parsed.limit = limit.clamp(1, 1000);
    parsed.offset = offset.max(0);
    parsed.cursor = cursor;
    // COUNT 治理：仅首页且无筛选时返回精确总数；其余（含加载更多）total=-1
    let has_filter = !parsed.words.is_empty()
        || !parsed.types.is_empty()
        || !parsed.labels.is_empty()
        || !parsed.labels_all.is_empty()
        || !parsed.states.is_empty()
        || parsed.size_min.is_some()
        || parsed.size_max.is_some()
        || parsed.before.is_some()
        || parsed.after.is_some();
    parsed.need_total =
        need_total.unwrap_or_else(|| parsed.cursor.is_none() && offset == 0 && !has_filter);
    let store = store.lock().map_err(|e| e.to_string())?;
    let page = store.query(&parsed)?;
    let ms = started.elapsed().as_millis();
    let results = if page.total >= 0 {
        page.total
    } else {
        page.items.len() as i64
    };
    log::info!("query: q=\"{raw}\" results={results} ms={ms}");
    Ok(page)
}

/// 结构化查询（搜索语法 + 分页 + 总数）。
// 参数即命令线契约（query/limit/offset/sort/cursor/need_total），保留平铺签名。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn query_files(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    cursor: Option<String>,
    need_total: Option<bool>,
) -> Result<QueryPage, String> {
    run_query(
        &store,
        query.as_deref(),
        limit.unwrap_or(DEFAULT_LIST_LIMIT),
        offset.unwrap_or(0),
        sort_by,
        sort_dir,
        cursor,
        need_total,
    )
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

/// 内置扩展名映射表（只读）。
#[tauri::command]
pub fn list_classify_defaults() -> Vec<ClassifyDefaultEntry> {
    DEFAULT_EXTENSION_MAP
        .iter()
        .map(|(ext, category)| ClassifyDefaultEntry {
            extension: (*ext).to_string(),
            category: category.key().to_string(),
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_files_cmd_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_dir_target_handles_dir_file_and_missing() {
        let dir = temp_dir("resolve");
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let file = sub.join("a.pdf");
        fs::write(&file, "x").unwrap();

        assert_eq!(
            resolve_dir_target_inner(&sub.to_string_lossy()).unwrap(),
            normalize_path(&sub.to_string_lossy())
        );
        assert_eq!(
            resolve_dir_target_inner(&file.to_string_lossy()).unwrap(),
            normalize_path(&sub.to_string_lossy())
        );
        assert!(resolve_dir_target_inner("C:/not-exist-xyz").is_err());
        assert!(resolve_dir_target_inner("").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn common_dirs_only_returns_existing_in_order() {
        let base = temp_dir("common");
        fs::create_dir_all(base.join("Downloads")).unwrap();
        fs::create_dir_all(base.join("Desktop")).unwrap();
        // Documents 不创建 → 应被跳过
        let dirs = common_dirs_from(&base);
        let kinds: Vec<&str> = dirs.iter().map(|d| d.kind.as_str()).collect();
        assert_eq!(kinds, vec!["downloads", "desktop"]);
        assert!(dirs.iter().all(|d| Path::new(&d.path).is_dir()));
        let _ = fs::remove_dir_all(&base);
    }
}
