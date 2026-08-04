//! 归档命令：手动/筛选批量/项目归档、撤销、最近归档列表。
use crate::core::archive::{
    move_error, target_collides, unique_dest, ArchiveBatch, ArchiveFailure, ArchiveOp,
    ArchiveOutcome, MAX_BATCH_FILES, PROJECT_ARCHIVE_DIR,
};
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key};
use crate::core::project::{discover_projects, FeatureDetector, ProjectDetector, ProjectKind};
use crate::core::query::parse_query;
use crate::infra::archive_engine::{
    archive_files as engine_archive_files, now_millis, undo_one_file,
};
use crate::infra::shortcut;
use crate::infra::storage;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

fn require_root(app: &AppHandle) -> Result<String, String> {
    let root = storage::load_settings(app).archive_root;
    if root.trim().is_empty() {
        return Err("请先在设置中配置归档根目录".to_string());
    }
    Ok(root)
}

fn store(app: &AppHandle) -> State<'_, Arc<Mutex<dyn IndexStore>>> {
    app.state::<Arc<Mutex<dyn IndexStore>>>()
}

/// 手动批量归档（单文件也走此入口，batch 为 1）。
#[tauri::command]
pub fn archive_files(app: AppHandle, paths: Vec<String>) -> Result<ArchiveOutcome, String> {
    let root = require_root(&app)?;
    if paths.is_empty() {
        return Err("没有选择文件".to_string());
    }
    let paths: Vec<String> = paths.into_iter().map(|p| normalize_path(&p)).collect();
    let batch_id = now_millis();
    let outcome = engine_archive_files(&store(&app), &root, &paths, batch_id)?;
    if outcome.archived == 0 {
        let first = outcome
            .failed
            .first()
            .map(|f| f.error.clone())
            .unwrap_or_else(|| "没有文件归档成功".to_string());
        return Err(first);
    }
    log::info!("archive: 开始 batch={batch_id} count={}", outcome.archived);
    Ok(outcome)
}

/// 归档当前筛选结果（后端重查，仅 indexed，上限 200）。
#[tauri::command]
pub fn archive_filtered(app: AppHandle, query: String) -> Result<ArchiveOutcome, String> {
    let root = require_root(&app)?;
    let mut file_query = parse_query(&query);
    file_query.states = vec!["indexed".to_string()];
    file_query.limit = MAX_BATCH_FILES as i64 + 1;
    file_query.offset = 0;
    let page = store(&app)
        .lock()
        .map_err(|e| e.to_string())?
        .query(&file_query)?;
    if page.total > MAX_BATCH_FILES as i64 {
        return Err(format!(
            "当前筛选共 {} 个文件，超过单次 200 上限，请先收窄筛选",
            page.total
        ));
    }
    if page.items.is_empty() {
        return Err("当前筛选没有可归档的文件".to_string());
    }
    let paths: Vec<String> = page.items.into_iter().map(|r| r.path).collect();
    let batch_id = now_millis();
    let outcome = engine_archive_files(&store(&app), &root, &paths, batch_id)?;
    if outcome.archived == 0 {
        let first = outcome
            .failed
            .first()
            .map(|f| f.error.clone())
            .unwrap_or_else(|| "没有文件归档成功".to_string());
        return Err(first);
    }
    log::info!(
        "archive: 筛选归档 batch={batch_id} count={}",
        outcome.archived
    );
    Ok(outcome)
}

/// 项目单元归档：整目录移动 + project_dirs 更新 + 快捷方式重建。
#[tauri::command]
pub fn archive_project(app: AppHandle, path: String) -> Result<ArchiveOutcome, String> {
    let path = normalize_path(&path);
    let root = require_root(&app)?;
    let mut settings = storage::load_settings(&app);
    let detector = FeatureDetector;
    let projects = discover_projects(&settings.watched_dirs, &settings.project_dirs, &detector);
    let info = projects
        .iter()
        .find(|p| path_key(&p.path) == path_key(&path))
        .ok_or_else(|| "不是已知项目".to_string())?;
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("项目目录不存在".to_string());
    }
    let name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "项目名为空".to_string())?;
    let dest = unique_dest(Path::new(&format!("{root}/{PROJECT_ARCHIVE_DIR}/{name}")))?;
    if target_collides(&path, &dest.to_string_lossy()) {
        return Err("归档根不能位于项目内部或与项目相同".to_string());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建归档目录失败: {e}"))?;
    }
    std::fs::rename(dir, &dest).map_err(|e| move_error(&path, e))?;
    let dest_str = normalize_path(&dest.to_string_lossy());
    let batch_id = now_millis();
    let journal_result = (|| -> Result<(), String> {
        settings.project_dirs = settings
            .project_dirs
            .iter()
            .map(|d| {
                if path_key(d) == path_key(&path) {
                    dest_str.clone()
                } else {
                    d.clone()
                }
            })
            .collect();
        storage::save_settings(&app, &settings)?;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let icon_dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("shortcut-icons");
        let store = store(&app);
        let links = store
            .lock()
            .map_err(|e| e.to_string())?
            .shortcuts_under(&path)?;
        for link in links {
            shortcut::rewrite_project_shortcut_at(
                Path::new(&link.lnk_path),
                &dest_str,
                info.kind,
                &exe,
                &icon_dir,
            )?;
            store
                .lock()
                .map_err(|e| e.to_string())?
                .update_shortcut_target(&link.lnk_path, &dest_str)?;
            log::info!("shortcut: 重写 lnk={} -> {dest_str}", link.lnk_path);
        }
        store
            .lock()
            .map_err(|e| e.to_string())?
            .insert_archive_op(&ArchiveOp {
                id: 0,
                batch_id,
                kind: "project".to_string(),
                source: path.clone(),
                dest: dest_str.clone(),
                created_at: now_millis(),
                undone_at: None,
            })?;
        Ok(())
    })();
    if let Err(e) = journal_result {
        let _ = std::fs::rename(&dest, &path);
        return Err(format!("归档项目失败，已还原: {e}"));
    }
    log::info!("archive: 项目 {path} -> {dest_str}");
    Ok(ArchiveOutcome {
        batch_id: Some(batch_id),
        archived: 1,
        failed: Vec::new(),
    })
}

/// 撤销一批归档（文件与项目混合处理，部分失败保留成功项）。
#[tauri::command]
pub fn undo_archive(app: AppHandle, batch_id: i64) -> Result<ArchiveOutcome, String> {
    let store = store(&app);
    let ops = store
        .lock()
        .map_err(|e| e.to_string())?
        .ops_for_batch(batch_id)?;
    if ops.is_empty() {
        return Err("批次不存在".to_string());
    }
    let mut outcome = ArchiveOutcome {
        batch_id: Some(batch_id),
        archived: 0,
        failed: Vec::new(),
    };
    let mut done_ids: Vec<i64> = Vec::new();
    for op in ops {
        if op.undone_at.is_some() {
            continue;
        }
        let result = if op.kind == "project" {
            undo_project(&app, &store, &op)
        } else {
            undo_one_file(&store, &op)
        };
        match result {
            Ok(()) => {
                outcome.archived += 1;
                done_ids.push(op.id);
            }
            Err(error) => outcome.failed.push(ArchiveFailure {
                path: op.dest.clone(),
                error,
            }),
        }
    }
    store
        .lock()
        .map_err(|e| e.to_string())?
        .mark_ops_undone(&done_ids)?;
    log::info!(
        "archive: 撤销 batch={batch_id} ok={} fail={}",
        outcome.archived,
        outcome.failed.len()
    );
    Ok(outcome)
}

fn undo_project(
    app: &AppHandle,
    store: &Arc<Mutex<dyn IndexStore>>,
    op: &ArchiveOp,
) -> Result<(), String> {
    if Path::new(&op.source).exists() {
        return Err(format!("原位置已有内容，未还原: {}", op.source));
    }
    if !Path::new(&op.dest).is_dir() {
        return Err(format!("归档目标已不存在: {}", op.dest));
    }
    std::fs::rename(&op.dest, &op.source).map_err(|e| move_error(&op.dest, e))?;

    let mut settings = storage::load_settings(app);
    settings.project_dirs = settings
        .project_dirs
        .iter()
        .map(|d| {
            if path_key(d) == path_key(&op.dest) {
                op.source.clone()
            } else {
                d.clone()
            }
        })
        .collect();
    storage::save_settings(app, &settings)?;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let icon_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("shortcut-icons");
    let kind = FeatureDetector
        .detect(Path::new(&op.source))
        .unwrap_or(ProjectKind::Generic);
    let links = store
        .lock()
        .map_err(|e| e.to_string())?
        .shortcuts_under(&op.dest)?;
    for link in links {
        shortcut::rewrite_project_shortcut_at(
            Path::new(&link.lnk_path),
            &op.source,
            kind,
            &exe,
            &icon_dir,
        )?;
        store
            .lock()
            .map_err(|e| e.to_string())?
            .update_shortcut_target(&link.lnk_path, &op.source)?;
        log::info!("shortcut: 重写 lnk={} -> {}", link.lnk_path, op.source);
    }
    log::info!("archive: 撤销项目 {} <- {}", op.source, op.dest);
    Ok(())
}

/// 最近归档批次列表。
#[tauri::command]
pub fn list_archive_batches(app: AppHandle, limit: i64) -> Result<Vec<ArchiveBatch>, String> {
    let limit = limit.clamp(1, 200);
    store(&app)
        .lock()
        .map_err(|e| e.to_string())?
        .list_archive_batches(limit)
}
