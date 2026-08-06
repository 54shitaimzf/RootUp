//! 项目、智能打开与桌面快捷方式命令。
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key};
use crate::core::project::{
    detect_project_kind_with_feature, discover_projects, find_project_root, FeatureDetector,
    ProjectInfo, ProjectKind, ProjectSource, MAX_PROJECT_DEPTH,
};
use crate::core::settings::PREFERRED_IDE_NONE;
use crate::core::tools::{self, extension_of};
use crate::infra::app_finder::{
    build_open_args, detect_installed_tools, find_app, CommandRunner, SystemAppEnv, SystemRunner,
};
use crate::infra::archive_engine::now_millis;
use crate::infra::shortcut;
use crate::infra::storage;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutcome {
    pub opened_with: String,
    pub tool: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOutcome {
    pub path: String,
    pub name: String,
    pub kind: String,
}

fn outcome(opened_with: &str, tool: Option<String>, message: Option<String>) -> OpenOutcome {
    OpenOutcome {
        opened_with: opened_with.to_string(),
        tool,
        message,
    }
}

fn dir_name(dir: &Path) -> String {
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| normalize_path(&dir.to_string_lossy()))
}

/// 把任意路径解析为项目：目录自身 / 文件向上找项目根（找不到用父目录 Generic）。
fn resolve_project(path: &str) -> Result<ProjectInfo, String> {
    let detector = FeatureDetector;
    let p = PathBuf::from(path);
    if p.is_dir() {
        let (kind, detected_by) =
            detect_project_kind_with_feature(&p).unwrap_or((ProjectKind::Generic, String::new()));
        return Ok(ProjectInfo {
            path: normalize_path(path),
            name: dir_name(&p),
            kind,
            source: ProjectSource::Manual,
            detected_by: (!detected_by.is_empty()).then_some(detected_by),
        });
    }
    if p.is_file() {
        if let Some(info) = find_project_root(&p, MAX_PROJECT_DEPTH, &detector) {
            return Ok(info);
        }
        let dir = p.parent().unwrap_or(&p).to_path_buf();
        return Ok(ProjectInfo {
            path: normalize_path(&dir.to_string_lossy()),
            name: dir_name(&dir),
            kind: ProjectKind::Generic,
            source: ProjectSource::Manual,
            detected_by: None,
        });
    }
    Err("路径不存在".to_string())
}

/// 向上最多 5 层检查 `.obsidian`（vault 内 .md 优先 Obsidian 打开）。
fn in_obsidian_vault(path: &Path) -> bool {
    let mut dir = if path.is_file() {
        path.parent().unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    };
    for _ in 0..=MAX_PROJECT_DEPTH {
        if tools::is_obsidian_vault(&dir) {
            return true;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
    false
}

/// 项目列表：手动目录 + 监控目录直接子目录（去重、排序）。
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Vec<ProjectInfo> {
    let settings = storage::load_settings(&app);
    let detector = FeatureDetector;
    let projects = discover_projects(&settings.watched_dirs, &settings.project_dirs, &detector);
    log::info!("project: 发现 {} 个", projects.len());
    projects
}

#[tauri::command]
pub fn add_project_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = normalize_path(&dir);
    if dir.is_empty() {
        return Err("目录不能为空".into());
    }
    if !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }
    let mut settings = storage::load_settings(&app);
    if settings
        .project_dirs
        .iter()
        .any(|d| path_key(d) == path_key(&dir))
    {
        return Err("该目录已在项目列表中".into());
    }
    settings.project_dirs.push(dir.clone());
    storage::save_settings(&app, &settings)?;
    crate::app::refresh_managed_state(&app)?;
    log::info!("project: 添加 {dir}");
    Ok(())
}

#[tauri::command]
pub fn remove_project_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = normalize_path(&dir);
    let mut settings = storage::load_settings(&app);
    settings
        .project_dirs
        .retain(|d| path_key(d) != path_key(&dir));
    storage::save_settings(&app, &settings)?;
    crate::app::refresh_managed_state(&app)?;
    log::info!("project: 移除 {dir}");
    Ok(())
}

/// 用 IDE/工具打开项目；找不到对应工具时回退资源管理器（永不报错卡住）。
#[tauri::command]
pub fn open_project(app: AppHandle, path: String) -> Result<OpenOutcome, String> {
    let info = resolve_project(&path)?;
    let settings = storage::load_settings(&app);
    let env = SystemAppEnv;
    let runner = SystemRunner;

    if settings.preferred_ide == PREFERRED_IDE_NONE {
        app.opener()
            .open_path(&info.path, None::<&str>)
            .map_err(|e| e.to_string())?;
        log::info!("ide: 回退资源管理器 dir={}", info.path);
        return Ok(outcome(
            "explorer",
            None,
            Some("首选 IDE 已关闭，已用资源管理器打开目录".into()),
        ));
    }

    let candidates: Vec<&str> = if settings.preferred_ide == "auto" {
        tools::ide_candidates_for(info.kind).to_vec()
    } else {
        vec![settings.preferred_ide.as_str()]
    };

    for tool in candidates {
        if let Some(candidate) = find_app(tool, &settings.custom_open_commands, &env) {
            let args = build_open_args(tool, Path::new(&info.path));
            match runner.run(&candidate.exe, &args) {
                Ok(()) => {
                    log::info!(
                        "ide: 打开 dir={} kind={} tool={} source={}",
                        info.path,
                        info.kind.key(),
                        tool,
                        candidate.source
                    );
                    return Ok(outcome("ide", Some(tool.to_string()), None));
                }
                Err(e) => log::warn!("ide: 启动失败 tool={tool} err={e}"),
            }
        }
    }

    app.opener()
        .open_path(&info.path, None::<&str>)
        .map_err(|e| e.to_string())?;
    log::info!("ide: 回退资源管理器 dir={}", info.path);
    Ok(outcome(
        "explorer",
        None,
        Some("未检测到对应工具，已用资源管理器打开目录".into()),
    ))
}

/// 从代码文件定位所属项目并打开（无项目根则打开所在目录）。
#[tauri::command]
pub fn open_project_from_file(app: AppHandle, file_path: String) -> Result<OpenOutcome, String> {
    let path = normalize_path(&file_path);
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("文件不存在".into());
    }
    let detector = FeatureDetector;
    if let Some(info) = find_project_root(p, MAX_PROJECT_DEPTH, &detector) {
        return open_project(app, info.path);
    }
    let dir = p.parent().unwrap_or(p).to_string_lossy().to_string();
    app.opener()
        .open_path(&dir, None::<&str>)
        .map_err(|e| e.to_string())?;
    log::info!("ide: 无项目根回退目录 dir={dir}");
    Ok(outcome(
        "explorer",
        None,
        Some("未识别到所属项目，已打开所在目录".into()),
    ))
}

/// 智能打开文件：特殊工具优先，找不到一律系统默认打开。
#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<OpenOutcome, String> {
    let path = normalize_path(&path);
    let p = Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    let settings = storage::load_settings(&app);
    let env = SystemAppEnv;
    let runner = SystemRunner;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let ext = extension_of(&name);
    let mut tools_list: Vec<&str> = match ext.as_deref() {
        Some("md") if in_obsidian_vault(p) => {
            vec![tools::TOOL_OBSIDIAN, tools::TOOL_TYPORA]
        }
        Some(ext) => tools::tool_candidates_for_extension(ext).to_vec(),
        None => Vec::new(),
    };
    tools_list.dedup();

    for tool in tools_list {
        if let Some(candidate) = find_app(tool, &settings.custom_open_commands, &env) {
            let args = build_open_args(tool, p);
            match runner.run(&candidate.exe, &args) {
                Ok(()) => {
                    log::info!(
                        "open: 文件 path={path} tool={tool} source={}",
                        candidate.source
                    );
                    return Ok(outcome("tool", Some(tool.to_string()), None));
                }
                Err(e) => log::warn!("open: 工具启动失败 tool={tool} err={e}"),
            }
        }
    }

    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())?;
    log::info!("open: 默认 path={path}");
    Ok(outcome("default", None, None))
}

/// 资源管理器定位（文件 /select,；目录直接打开）。
#[tauri::command]
pub fn reveal_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    let path = normalize_path(&path);
    let p = Path::new(&path);
    if !p.exists() {
        return Err("路径不存在".into());
    }
    if p.is_file() {
        app.opener()
            .reveal_item_in_dir(p)
            .map_err(|e| e.to_string())?;
    } else {
        app.opener()
            .open_path(&path, None::<&str>)
            .map_err(|e| e.to_string())?;
    }
    log::info!("open: 定位 path={path}");
    Ok(())
}

/// 创建桌面快捷方式（目标 = RootUp --open-project）。
#[tauri::command]
pub fn create_project_shortcut(app: AppHandle, path: String) -> Result<ShortcutOutcome, String> {
    let info = resolve_project(&path)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let icon_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("shortcut-icons");
    let lnk = shortcut::create_project_shortcut(&info, &exe, &desktop, &icon_dir)?;
    let store = app.state::<Arc<Mutex<dyn IndexStore>>>();
    store.lock().map_err(|e| e.to_string())?.upsert_shortcut(
        &lnk.to_string_lossy(),
        &info.path,
        now_millis(),
    )?;
    log::info!("shortcut: 创建 name={} target={}", info.name, info.path);
    Ok(ShortcutOutcome {
        path: lnk.to_string_lossy().to_string(),
        name: info.name,
        kind: info.kind.key().to_string(),
    })
}

/// 创建桌面“打开未完成作业”快捷方式（目标 = RootUp --open-homework，幂等）。
#[tauri::command]
pub fn create_homework_shortcut(app: AppHandle) -> Result<ShortcutOutcome, String> {
    let settings = storage::load_settings(&app);
    let name = if settings.language == "en" {
        "Open Homework (RootUp)"
    } else {
        "打开未完成作业 (RootUp)"
    };
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let icon_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("shortcut-icons");
    let lnk = shortcut::create_shortcut(
        &exe,
        &desktop,
        &icon_dir,
        name,
        "--open-homework",
        "rootup.ico",
    )?;
    log::info!("shortcut: 创建未完成作业入口 {}", lnk.display());
    Ok(ShortcutOutcome {
        path: lnk.to_string_lossy().to_string(),
        name: name.to_string(),
        kind: "homework".to_string(),
    })
}

/// 当前环境已检测到的工具 key 列表（供引导提示与帮助中心展示）。
#[tauri::command]
pub fn list_detected_tools(app: AppHandle) -> Vec<String> {
    let settings = storage::load_settings(&app);
    let env = SystemAppEnv;
    let tools = detect_installed_tools(&settings.custom_open_commands, &env);
    log::info!("tools: 检测 {} 个", tools.len());
    tools.iter().map(|tool| (*tool).to_string()).collect()
}

/// 打开外部链接：仅允许 https 官方白名单域名。
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !tools::is_allowed_url(&url) {
        log::warn!("open: 拒绝非白名单链接 {url}");
        return Err("不允许打开的链接".into());
    }
    app.opener()
        .open_url(url.clone(), None::<&str>)
        .map_err(|e| e.to_string())?;
    log::info!("open: 链接 {url}");
    Ok(())
}
