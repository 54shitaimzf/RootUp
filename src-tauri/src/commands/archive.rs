//! 归档命令：手动/筛选批量/项目归档、撤销、最近归档列表。
use crate::core::archive::{
    move_error, target_collides, unique_dest, ArchiveBatch, ArchiveFailure, ArchiveOp,
    ArchiveOutcome, MAX_BATCH_FILES, PROJECT_ARCHIVE_DIR,
};
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key};
use crate::core::project::{discover_projects, FeatureDetector, ProjectDetector, ProjectKind};
use crate::core::query::parse_query;
use crate::core::settings::Settings;
use crate::infra::archive_engine::{
    apply_project_journal, archive_files as engine_archive_files, next_batch_id, now_millis,
    remap_target, undo_one_file, ProjectJournal, ProjectLinkEffect, ProjectSideEffects,
};
use crate::infra::shortcut;
use crate::infra::storage;
use std::path::{Path, PathBuf};
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
    let batch_id = next_batch_id();
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
    let batch_id = next_batch_id();
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
    let settings_backup = settings.clone();
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
    let store = store(&app);
    let store_arc = store.inner().clone();
    // 移动前登记快捷方式清单（失败回滚需要归档前目标）
    let links: Vec<ProjectLinkEffect> = store
        .lock()
        .map_err(|e| e.to_string())?
        .shortcuts_under(&path)?
        .into_iter()
        .map(|link| ProjectLinkEffect {
            lnk_path: link.lnk_path,
            original_target: link.target_path.clone(),
            new_target: remap_target(&link.target_path, &path, &dest.to_string_lossy()),
        })
        .collect();
    std::fs::rename(dir, &dest).map_err(|e| move_error(&path, e))?;
    let dest_str = normalize_path(&dest.to_string_lossy());
    let batch_id = next_batch_id();
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
    let effects = ProjectSideEffects {
        settings,
        settings_backup,
        links,
        kind: info.kind,
        insert_op: Some(ArchiveOp {
            id: 0,
            batch_id,
            kind: "project".to_string(),
            source: path.clone(),
            dest: dest_str.clone(),
            created_at: now_millis(),
            undone_at: None,
        }),
    };
    let journal = TauriProjectJournal {
        app: &app,
        exe: std::env::current_exe().map_err(|e| e.to_string())?,
        icon_dir: app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("shortcut-icons"),
        store: store_arc,
    };
    apply_project_journal(&effects, &journal, &dest_str, &path)?;
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
    let mut settings = storage::load_settings(app);
    let settings_backup = settings.clone();
    let kind = FeatureDetector
        .detect(Path::new(&op.dest))
        .unwrap_or(ProjectKind::Generic);
    // 移动前登记快捷方式清单（失败回滚需要归档态目标）
    let links: Vec<ProjectLinkEffect> = store
        .lock()
        .map_err(|e| e.to_string())?
        .shortcuts_under(&op.dest)?
        .into_iter()
        .map(|link| ProjectLinkEffect {
            lnk_path: link.lnk_path,
            original_target: link.target_path.clone(),
            new_target: remap_target(&link.target_path, &op.dest, &op.source),
        })
        .collect();
    std::fs::rename(&op.dest, &op.source).map_err(|e| move_error(&op.dest, e))?;
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
    let effects = ProjectSideEffects {
        settings,
        settings_backup,
        links,
        kind,
        insert_op: None,
    };
    let journal = TauriProjectJournal {
        app,
        exe: std::env::current_exe().map_err(|e| e.to_string())?,
        icon_dir: app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("shortcut-icons"),
        store: store.clone(),
    };
    apply_project_journal(&effects, &journal, &op.source, &op.dest)?;
    log::info!("archive: 撤销项目 {} <- {}", op.source, op.dest);
    Ok(())
}

/// Tauri 侧的项目 journal 实现：settings 持久化、快捷方式重建与索引登记。
struct TauriProjectJournal<'a> {
    app: &'a AppHandle,
    exe: PathBuf,
    icon_dir: PathBuf,
    store: Arc<Mutex<dyn IndexStore>>,
}

impl ProjectJournal for TauriProjectJournal<'_> {
    fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        storage::save_settings(self.app, settings)
    }

    fn rewrite_shortcut(
        &self,
        lnk_path: &str,
        target: &str,
        kind: ProjectKind,
    ) -> Result<(), String> {
        shortcut::rewrite_project_shortcut_at(
            Path::new(lnk_path),
            target,
            kind,
            &self.exe,
            &self.icon_dir,
        )
    }

    fn update_shortcut_target(&self, lnk_path: &str, target: &str) -> Result<(), String> {
        self.store
            .lock()
            .map_err(|e| e.to_string())?
            .update_shortcut_target(lnk_path, target)
    }

    fn insert_archive_op(&self, op: &ArchiveOp) -> Result<(), String> {
        self.store
            .lock()
            .map_err(|e| e.to_string())?
            .insert_archive_op(op)
            .map(|_| ())
    }
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
