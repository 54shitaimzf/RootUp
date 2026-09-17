//! 归档命令：手动/筛选批量/项目归档、撤销、最近归档列表。
use crate::core::archive::{
    failure, is_owned_path, move_error, target_collides, unique_dest, ArchiveBatch, ArchiveMove,
    ArchiveOp, ArchiveOutcome, MAX_BATCH_FILES, PHASE_UNDO, PROJECT_ARCHIVE_DIR,
};
use crate::core::archive_guard::assess_archive_root as assess_archive_root_inner;
use crate::core::archive_guard::ArchiveAssessment;
use crate::core::archive_safety::{
    reference_report, scan_paths, software_conflicts, PathStats, MAX_SCAN_ENTRIES,
};
use crate::core::error_codes::{
    coded, ARCHIVE_FORBIDDEN, ARCHIVE_NO_ROOT, ARCHIVE_SOFTWARE_PROTECTED, ARCHIVE_TARGET_COLLIDES,
    ARCHIVE_UNDO_CONFLICT,
};
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key};
use crate::core::project::{discover_projects, FeatureDetector, ProjectDetector, ProjectKind};
use crate::core::query::parse_query;
use crate::core::settings::Settings;
use crate::infra::archive_engine::{
    apply_project_journal, archive_files as engine_archive_files, next_batch_id, remap_target,
    undo_one_file, ProjectJournal, ProjectLinkEffect, ProjectSideEffects,
};
use crate::infra::settings_io;
use crate::infra::shortcut;
use crate::infra::storage;
use crate::infra::time::now_millis;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

fn require_root(app: &AppHandle) -> Result<String, String> {
    let root = storage::load_settings(app).archive_root;
    if root.trim().is_empty() {
        return Err(coded(ARCHIVE_NO_ROOT, "请先在设置中配置归档根目录"));
    }
    Ok(root)
}

/// 命令层归属校验：显式传入的归档源必须位于监控/项目目录内（防越权路径）。
/// 筛选归档的源来自索引重查，不经此校验。
pub(crate) fn require_owned(app: &AppHandle, paths: &[String]) -> Result<(), String> {
    let settings = storage::load_settings(app);
    let mut roots = settings.watched_dirs.clone();
    roots.extend(settings.project_dirs.iter().cloned());
    if let Some(path) = paths.iter().find(|p| !is_owned_path(p, &roots)) {
        return Err(coded(
            ARCHIVE_FORBIDDEN,
            format!("{path}: 不在监控或项目目录内，禁止归档"),
        ));
    }
    Ok(())
}

fn store(app: &AppHandle) -> State<'_, Arc<Mutex<dyn IndexStore>>> {
    app.state::<Arc<Mutex<dyn IndexStore>>>()
}

/// 变更日志写入（0.8.8 变更日志 v1）：失败只记日志不阻断主流程（追溯数据，非关键路径）。
pub(crate) fn log_action(app: &AppHandle, action: &str, detail: &str, batch_id: Option<i64>) {
    let result = store(app)
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|mut s| s.log_action(action, detail, batch_id, now_millis()));
    if let Err(e) = result {
        log::warn!("action-log: 写入失败 action={action} err={e}");
    }
}

/// 现存软件单元路径（预检与整树移动保护共用）。
pub(crate) fn live_software_units(
    store: &State<'_, Arc<Mutex<dyn IndexStore>>>,
) -> Result<Vec<String>, String> {
    let mut query = parse_query("kind:software state:indexed");
    query.need_total = false;
    query.limit = 10_000;
    let page = store.lock().map_err(|e| e.to_string())?.query(&query)?;
    Ok(page.items.into_iter().map(|r| r.path).collect())
}

/// 整树移动软件保护：源命中软件单元（相同/内部/包含）时默认拒绝，
/// 前端确认后以 allow_software=true 显式放行（风险确认，错误码 archive.software_protected）。
pub(crate) fn software_guard(
    store: &State<'_, Arc<Mutex<dyn IndexStore>>>,
    paths: &[String],
    allow: bool,
) -> Result<(), String> {
    if allow {
        return Ok(());
    }
    let units = live_software_units(store)?;
    software_guard_paths(paths, &units)
}

/// 纯逻辑内核（可单测）：冲突非空即拒绝。
fn software_guard_paths(paths: &[String], units: &[String]) -> Result<(), String> {
    let conflicts = software_conflicts(paths, units);
    if conflicts.is_empty() {
        return Ok(());
    }
    Err(coded(
        ARCHIVE_SOFTWARE_PROTECTED,
        format!(
            "{}: 已识别为软件组件，禁止整树移动（可在确认弹窗中选择风险确认）",
            conflicts.join(", ")
        ),
    ))
}

/// 归档预检报告（0.8.8）：数量/体积/可执行文件/符号链接 + 软件冲突 + 引用快捷方式。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    #[serde(flatten)]
    pub stats: PathStats,
    /// 与源冲突的软件单元（相同/内部/包含）
    pub software_units: Vec<String>,
    /// 指向源树内部的快捷方式 lnk 路径
    pub shortcuts: Vec<String>,
}

/// 归档预检：批量前返回统计与风险，前端确认后执行。
#[tauri::command]
pub fn archive_preflight(
    store: State<'_, Arc<Mutex<dyn IndexStore>>>,
    paths: Vec<String>,
) -> Result<PreflightReport, String> {
    if paths.is_empty() {
        return Err("没有选择文件".to_string());
    }
    let paths: Vec<String> = paths.into_iter().map(|p| normalize_path(&p)).collect();
    let stats = scan_paths(&paths, MAX_SCAN_ENTRIES);
    let units = live_software_units(&store)?;
    let software_units = software_conflicts(&paths, &units);
    let mut shortcut_pairs: Vec<(String, String)> = Vec::new();
    {
        let locked = store.lock().map_err(|e| e.to_string())?;
        for path in &paths {
            for record in locked.shortcuts_under(path)? {
                shortcut_pairs.push((record.lnk_path, record.target_path));
            }
        }
    }
    let shortcuts = reference_report(&paths, &shortcut_pairs).shortcuts;
    Ok(PreflightReport {
        stats,
        software_units,
        shortcuts,
    })
}

/// 手动批量归档（单文件也走此入口，batch 为 1）。
#[tauri::command]
pub fn archive_files(
    app: AppHandle,
    paths: Vec<String>,
    allow_software: Option<bool>,
) -> Result<ArchiveOutcome, String> {
    let root = require_root(&app)?;
    if paths.is_empty() {
        return Err("没有选择文件".to_string());
    }
    let paths: Vec<String> = paths.into_iter().map(|p| normalize_path(&p)).collect();
    require_owned(&app, &paths)?;
    software_guard(&store(&app), &paths, allow_software.unwrap_or(false))?;
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
    log_action(
        &app,
        "archive",
        &format!("count={}", outcome.archived),
        Some(batch_id),
    );
    log::info!("archive: 开始 batch={batch_id} count={}", outcome.archived);
    Ok(outcome)
}

/// 归档当前筛选结果（后端重查，仅 indexed，上限 200）。
#[tauri::command]
pub fn archive_filtered(
    app: AppHandle,
    query: String,
    allow_software: Option<bool>,
) -> Result<ArchiveOutcome, String> {
    let root = require_root(&app)?;
    let mut file_query = parse_query(&query);
    file_query.states = vec!["indexed".to_string()];
    file_query.limit = MAX_BATCH_FILES as i64 + 1;
    file_query.offset = 0;
    file_query.need_total = true;
    let page = store(&app)
        .lock()
        .map_err(|e| e.to_string())?
        .query(&file_query)?;
    if page.total > MAX_BATCH_FILES as i64 {
        return Err(coded(
            crate::core::error_codes::ARCHIVE_TOO_MANY,
            format!(
                "当前筛选共 {} 个文件，超过单次 200 上限，请先收窄筛选",
                page.total
            ),
        ));
    }
    if page.items.is_empty() {
        return Err("当前筛选没有可归档的文件".to_string());
    }
    let paths: Vec<String> = page.items.into_iter().map(|r| r.path).collect();
    software_guard(&store(&app), &paths, allow_software.unwrap_or(false))?;
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
    log_action(
        &app,
        "archive",
        &format!("count={}", outcome.archived),
        Some(batch_id),
    );
    log::info!(
        "archive: 筛选归档 batch={batch_id} count={}",
        outcome.archived
    );
    Ok(outcome)
}

/// 项目单元归档：整目录移动 + project_dirs 更新 + 快捷方式重建。
#[tauri::command]
pub fn archive_project(
    app: AppHandle,
    path: String,
    allow_software: Option<bool>,
) -> Result<ArchiveOutcome, String> {
    let path = normalize_path(&path);
    let root = require_root(&app)?;
    software_guard(
        &store(&app),
        std::slice::from_ref(&path),
        allow_software.unwrap_or(false),
    )?;
    let detector = FeatureDetector;
    let snapshot = storage::load_settings(&app);
    let projects = discover_projects(&snapshot.watched_dirs, &snapshot.project_dirs, &detector);
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
        return Err(coded(
            ARCHIVE_TARGET_COLLIDES,
            "归档根不能位于项目内部或与项目相同",
        ));
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
    // 移动成功后重读最新设置再做 project_dirs 重映射，缩小与其他写入者的竞态窗口；
    // 写入经单入口（save_locked），journal 失败时仍以 backup 尽力回滚。
    let mut latest = storage::load_settings(&app);
    let settings_backup = latest.clone();
    latest.project_dirs = latest
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
        settings: latest,
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
    log_action(&app, "archive", &format!("project={path}"), Some(batch_id));
    log::info!("archive: 项目 {path} -> {dest_str}");
    Ok(ArchiveOutcome {
        batch_id: Some(batch_id),
        archived: 1,
        failed: Vec::new(),
        results: vec![ArchiveMove {
            source: path,
            dest: dest_str,
        }],
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
        results: Vec::new(),
    };
    for op in ops {
        if op.undone_at.is_some() {
            continue;
        }
        let result = if op.kind == "project" {
            undo_project(&app, &store, &op).and_then(|()| {
                store
                    .lock()
                    .map_err(|e| e.to_string())?
                    .mark_ops_undone(&[op.id])
            })
        } else {
            undo_one_file(&store, &op)
        };
        match result {
            Ok(()) => {
                outcome.archived += 1;
                outcome.results.push(ArchiveMove {
                    source: op.dest.clone(),
                    dest: op.source.clone(),
                });
            }
            Err(error) => outcome
                .failed
                .push(failure(op.dest.clone(), PHASE_UNDO, error)),
        }
    }
    if outcome.archived > 0 {
        log_action(
            &app,
            "undo",
            &format!("count={}", outcome.archived),
            Some(batch_id),
        );
    }
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
        return Err(coded(
            ARCHIVE_UNDO_CONFLICT,
            format!("原位置已有内容，未还原: {}", op.source),
        ));
    }
    if !Path::new(&op.dest).is_dir() {
        return Err(coded(
            ARCHIVE_UNDO_CONFLICT,
            format!("归档目标已不存在: {}", op.dest),
        ));
    }
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
    // 移回成功后重读最新设置再做 project_dirs 重映射，写入经单入口（save_locked）。
    let mut latest = storage::load_settings(app);
    let settings_backup = latest.clone();
    latest.project_dirs = latest
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
        settings: latest,
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
        // 单入口：互斥落盘 + 缓存刷新 + settings-changed 广播
        settings_io::save_locked(self.app, settings, &["project_dirs"])
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

/// 归档根安全评估（只读）：前端在选择 / 输入归档位置时即时展示风险分级。
/// 规则真源在 `core/archive_guard`，此处不做任何判定逻辑。
#[tauri::command]
pub fn assess_archive_root(path: String) -> Result<ArchiveAssessment, String> {
    Ok(assess_archive_root_inner(&path))
}

/// 推荐归档位置候选（只读）：用户核心目录下的专用子目录，天然通过安全评估。
/// 文档目录可能被系统重定向，存在性由前端展示层提示，此处不校验。
#[tauri::command]
pub fn recommended_archive_roots() -> Result<Vec<String>, String> {
    let profile = std::env::var("USERPROFILE").unwrap_or_default();
    if profile.is_empty() {
        return Ok(Vec::new());
    }
    let candidates = [
        format!("{profile}/Documents/RootUp 档案库"),
        format!("{profile}/RootUpArchive"),
    ];
    Ok(candidates.into_iter().map(|p| normalize_path(&p)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn software_guard_blocks_conflicts_and_allows_rest() {
        let units = vec!["C:/Watch/SomeApp".to_string()];
        // 命中软件单元（内部文件）→ 拒绝，错误带 code
        let err = software_guard_paths(&["C:/Watch/SomeApp/App/app.exe".to_string()], &units)
            .unwrap_err();
        assert_eq!(
            crate::core::error_codes::code_of(&err),
            Some(ARCHIVE_SOFTWARE_PROTECTED)
        );
        // 无冲突 → 放行
        assert!(software_guard_paths(&["C:/Watch/notes.txt".to_string()], &units).is_ok());
        // 冲突但 allow（风险确认在调用方短路）——直接验证纯内核对空冲突放行
        assert!(software_guard_paths(&[], &units).is_ok());
    }
}
