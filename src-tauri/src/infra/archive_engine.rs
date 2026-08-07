//! 归档引擎：文件级移动 + 索引迁移 + 操作日志（不依赖 Tauri，可测试）。
use crate::core::archive::{
    move_error, plan_file_target, target_collides, unique_dest, ArchiveFailure, ArchiveOp,
    ArchiveOutcome, UNDO_KEEP_BATCHES,
};
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key};
use crate::core::project::ProjectKind;
use crate::core::settings::Settings;
use crate::infra::time::now_millis;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

/// 批次号分配：进程内严格递增，基准为毫秒时间戳×1000，
/// 保证同一毫秒内的多个批次不会共用同一 id（无需数据库 schema 变更）。
static NEXT_BATCH_ID: AtomicI64 = AtomicI64::new(0);

/// 分配下一个归档批次号（进程内单调递增）。
pub fn next_batch_id() -> i64 {
    let base = now_millis().saturating_mul(1000);
    let mut current = NEXT_BATCH_ID.load(Ordering::Relaxed);
    loop {
        let next = base.max(current) + 1;
        match NEXT_BATCH_ID.compare_exchange_weak(
            current,
            next,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return next,
            Err(actual) => current = actual,
        }
    }
}

/// 把快捷方式目标从 `from_root` 重映射到 `to_root`（保持相对子路径）。
pub fn remap_target(target: &str, from_root: &str, to_root: &str) -> String {
    let from = normalize_path(from_root);
    let to = normalize_path(to_root);
    let target = normalize_path(target);
    let from_key = path_key(&from);
    let target_key = path_key(&target);
    if target_key == from_key {
        return to;
    }
    // 用 path_key 构造带分隔符的边界，避免误匹配同名前缀（C:/proj 不应命中 C:/proj2）。
    let boundary = if from_key.ends_with('/') {
        from_key
    } else {
        format!("{from_key}/")
    };
    if target_key.starts_with(&boundary) {
        let skip = if from.ends_with('/') {
            from.len()
        } else {
            from.len() + 1
        };
        let rel = &target[skip..];
        return format!("{to}/{rel}");
    }
    target
}

/// 项目 journal 中单条快捷方式的联动：应用写入 `new_target`，失败回滚到 `original_target`。
#[derive(Debug, Clone)]
pub struct ProjectLinkEffect {
    pub lnk_path: String,
    pub original_target: String,
    pub new_target: String,
}

/// 项目归档/撤销的副作用清单（settings 新值与回滚备份、快捷方式联动、可选归档日志）。
pub struct ProjectSideEffects {
    pub settings: Settings,
    pub settings_backup: Settings,
    pub links: Vec<ProjectLinkEffect>,
    pub kind: ProjectKind,
    pub insert_op: Option<ArchiveOp>,
}

/// 项目 journal 的外部副作用注入：命令层提供 Tauri 实现，测试可注入故障。
pub trait ProjectJournal {
    fn save_settings(&self, settings: &Settings) -> Result<(), String>;
    fn rewrite_shortcut(
        &self,
        lnk_path: &str,
        target: &str,
        kind: ProjectKind,
    ) -> Result<(), String>;
    fn update_shortcut_target(&self, lnk_path: &str, target: &str) -> Result<(), String>;
    fn insert_archive_op(&self, op: &ArchiveOp) -> Result<(), String>;
}

/// 应用项目移动后的 journal；任一步失败时尽力完整回滚：
/// settings 还原、快捷方式目标还原、目录移回 `dir_back`，然后返回原始错误。
pub fn apply_project_journal(
    effects: &ProjectSideEffects,
    ops: &dyn ProjectJournal,
    dir_current: &str,
    dir_back: &str,
) -> Result<(), String> {
    let apply = (|| -> Result<(), String> {
        ops.save_settings(&effects.settings)?;
        for link in &effects.links {
            ops.rewrite_shortcut(&link.lnk_path, &link.new_target, effects.kind)?;
            ops.update_shortcut_target(&link.lnk_path, &link.new_target)?;
            log::info!(
                "shortcut: 重写 lnk={} -> {}",
                link.lnk_path,
                link.new_target
            );
        }
        if let Some(op) = &effects.insert_op {
            ops.insert_archive_op(op)?;
        }
        Ok(())
    })();
    if let Err(error) = apply {
        if let Err(e) = ops.save_settings(&effects.settings_backup) {
            log::error!("archive: 回滚设置失败: {e}");
        }
        for link in &effects.links {
            if let Err(e) =
                ops.rewrite_shortcut(&link.lnk_path, &link.original_target, effects.kind)
            {
                log::error!("archive: 回滚快捷方式 {} 失败: {e}", link.lnk_path);
            }
            if let Err(e) = ops.update_shortcut_target(&link.lnk_path, &link.original_target) {
                log::error!("archive: 回滚快捷方式登记 {} 失败: {e}", link.lnk_path);
            }
        }
        if Path::new(dir_current).exists() {
            if let Err(e) = std::fs::rename(dir_current, dir_back) {
                log::error!("archive: 回滚目录移动 {dir_current} -> {dir_back} 失败: {e}");
            }
        }
        return Err(error);
    }
    Ok(())
}

/// 批量归档文件：逐文件执行，部分失败保留成功项；结束后裁剪旧日志。
pub fn archive_files(
    store: &Arc<Mutex<dyn IndexStore>>,
    root: &str,
    paths: &[String],
    batch_id: i64,
) -> Result<ArchiveOutcome, String> {
    let mut outcome = ArchiveOutcome {
        batch_id: Some(batch_id),
        archived: 0,
        failed: Vec::new(),
    };
    for path in paths {
        match archive_one(store, root, path, batch_id) {
            Ok(()) => outcome.archived += 1,
            Err(error) => outcome.failed.push(ArchiveFailure {
                path: normalize_path(path),
                error,
            }),
        }
    }
    store
        .lock()
        .map_err(|e| e.to_string())?
        .prune_archive_ops(UNDO_KEEP_BATCHES)?;
    Ok(outcome)
}

fn archive_one(
    store: &Arc<Mutex<dyn IndexStore>>,
    root: &str,
    path: &str,
    batch_id: i64,
) -> Result<(), String> {
    let path = normalize_path(path);
    if path.is_empty() {
        return Err("路径为空".to_string());
    }
    let record = store
        .lock()
        .map_err(|e| e.to_string())?
        .get_by_path(&path)?
        .ok_or_else(|| format!("文件不在索引中: {path}"))?;
    if record.state != "indexed" {
        return Err(format!("文件状态不是已索引: {path}"));
    }
    let file_name = Path::new(&path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "文件名为空".to_string())?;
    let planned = plan_file_target(root, &file_name, &record.labels)?;
    let dest = unique_dest(Path::new(&planned))?;
    if target_collides(&path, &dest.to_string_lossy()) {
        return Err("目标与源路径冲突".to_string());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建归档目录失败: {e}"))?;
    }
    std::fs::rename(&path, &dest).map_err(|e| move_error(&path, e))?;

    let dest_str = normalize_path(&dest.to_string_lossy());
    let journal_result = {
        let op = ArchiveOp {
            id: 0,
            batch_id,
            kind: "file".to_string(),
            source: path.clone(),
            dest: dest_str.clone(),
            created_at: now_millis(),
            undone_at: None,
        };
        let mut store = store.lock().map_err(|e| e.to_string())?;
        store.archive_record(&path, &dest_str, &op)
    };
    if let Err(e) = journal_result {
        // 索引/日志失败则把文件移回，保证不留半成品。
        let _ = std::fs::rename(&dest, &path);
        return Err(format!("索引更新失败，已还原: {e}"));
    }
    log::info!("archive: 移动 file={path} -> {dest_str}");
    Ok(())
}

/// 撤销一批文件操作（project 操作由命令层处理）。
#[cfg_attr(not(test), allow(dead_code))]
pub fn undo_file_batch(
    store: &Arc<Mutex<dyn IndexStore>>,
    batch_id: i64,
) -> Result<ArchiveOutcome, String> {
    let ops = store
        .lock()
        .map_err(|e| e.to_string())?
        .ops_for_batch(batch_id)?;
    let mut outcome = ArchiveOutcome {
        batch_id: Some(batch_id),
        archived: 0,
        failed: Vec::new(),
    };
    for op in ops {
        if op.kind != "file" || op.undone_at.is_some() {
            continue;
        }
        match undo_one_file(store, &op) {
            Ok(()) => outcome.archived += 1,
            Err(error) => outcome.failed.push(ArchiveFailure {
                path: op.dest.clone(),
                error,
            }),
        }
    }
    Ok(outcome)
}

pub fn undo_one_file(store: &Arc<Mutex<dyn IndexStore>>, op: &ArchiveOp) -> Result<(), String> {
    if Path::new(&op.source).exists() {
        return Err(format!("原位置已有文件，未还原: {}", op.source));
    }
    if !Path::new(&op.dest).exists() {
        return Err(format!("目标文件已不存在: {}", op.dest));
    }
    std::fs::rename(&op.dest, &op.source).map_err(|e| move_error(&op.dest, e))?;
    let result = store
        .lock()
        .map_err(|e| e.to_string())?
        .unarchive_record(&op.dest, &op.source, op.id);
    if let Err(e) = result {
        // 索引/日志失败则把文件移回，保证磁盘与索引一致。
        let _ = std::fs::rename(&op.source, &op.dest);
        return Err(format!("索引更新失败，已还原: {e}"));
    }
    log::info!("archive: 撤销 file={} <- {}", op.source, op.dest);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::archive::{ArchiveBatch, ShortcutRecord};
    use crate::core::index::{FileRecord, IndexStore};
    use crate::infra::index_store::SqliteIndexStore;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rootup_archive_engine_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn store() -> Arc<Mutex<dyn IndexStore>> {
        Arc::new(Mutex::new(
            SqliteIndexStore::open(":memory:").expect("内存库打开失败"),
        ))
    }

    fn indexed(path: &str, labels: &str) -> FileRecord {
        let mut r = FileRecord::new(path, 10, 1, "indexed");
        r.labels = labels.to_string();
        r
    }

    #[test]
    fn next_batch_id_is_unique_and_increasing() {
        let mut seen = std::collections::HashSet::new();
        let mut previous = i64::MIN;
        for _ in 0..5000 {
            let id = next_batch_id();
            assert!(seen.insert(id), "批次号重复: {id}");
            assert!(id > previous, "批次号未递增: {id} <= {previous}");
            previous = id;
        }
    }

    #[test]
    fn remap_target_keeps_relative_subpath() {
        assert_eq!(
            remap_target("C:/proj", "C:/proj", "C:/Archive/项目/proj"),
            "C:/Archive/项目/proj"
        );
        assert_eq!(
            remap_target("C:/proj/sub/a", "C:/proj", "C:/Archive/项目/proj"),
            "C:/Archive/项目/proj/sub/a"
        );
        assert_eq!(
            remap_target("C:/other", "C:/proj", "C:/Archive/x"),
            "C:/other"
        );
    }

    #[cfg(windows)]
    #[test]
    fn remap_target_is_case_insensitive_on_windows() {
        assert_eq!(
            remap_target("c:/PROJ/sub/a", "C:/proj", "C:/Archive/proj"),
            "C:/Archive/proj/sub/a"
        );
        assert_eq!(
            remap_target("C:/PROJ", "c:/proj", "C:/Archive/proj"),
            "C:/Archive/proj"
        );
        assert_eq!(
            remap_target("C:/Proj2/x", "C:/proj", "C:/Archive/proj"),
            "C:/Proj2/x"
        );
    }

    #[test]
    fn remap_target_handles_unicode_and_segment_boundaries() {
        assert_eq!(
            remap_target("C:/课程/资料/a.pdf", "C:/课程", "C:/归档/课程"),
            "C:/归档/课程/资料/a.pdf"
        );
        assert_eq!(
            remap_target("C:/课程2/a.pdf", "C:/课程", "C:/归档/课程"),
            "C:/课程2/a.pdf"
        );
    }

    /// 故障注入替身：只支持归档/撤销链路上用到的读取与写入，
    /// 其余方法不会被调用，直接 panic 以暴露意外调用。
    struct FailingArchiveStore {
        record: FileRecord,
        fail_archive: bool,
        fail_unarchive: bool,
    }

    impl IndexStore for FailingArchiveStore {
        fn get_by_path(&self, path: &str) -> Result<Option<FileRecord>, String> {
            if self.record.path == path {
                Ok(Some(self.record.clone()))
            } else {
                Ok(None)
            }
        }

        fn archive_record(
            &mut self,
            _from: &str,
            _to: &str,
            _op: &ArchiveOp,
        ) -> Result<(), String> {
            if self.fail_archive {
                Err("注入: 索引写入失败".into())
            } else {
                Ok(())
            }
        }

        fn unarchive_record(&mut self, _from: &str, _to: &str, _op_id: i64) -> Result<(), String> {
            if self.fail_unarchive {
                Err("注入: 索引写入失败".into())
            } else {
                Ok(())
            }
        }

        fn prune_archive_ops(&mut self, _keep: i64) -> Result<(), String> {
            Ok(())
        }

        fn upsert(&mut self, _record: &FileRecord) -> Result<(), String> {
            unimplemented!()
        }
        fn list(&self, _limit: i64, _offset: i64) -> Result<Vec<FileRecord>, String> {
            unimplemented!()
        }
        fn all_records(&self) -> Result<Vec<FileRecord>, String> {
            unimplemented!()
        }
        fn update_labels(&mut self, _path: &str, _labels: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn query(
            &self,
            _query: &crate::core::query::FileQuery,
        ) -> Result<crate::core::query::QueryPage, String> {
            unimplemented!()
        }
        fn upsert_many(&mut self, _records: &[FileRecord]) -> Result<(), String> {
            unimplemented!()
        }
        fn paths_with_prefix(&self, _dir: &str) -> Result<Vec<String>, String> {
            unimplemented!()
        }
        fn mark_missing(&mut self, _paths: &[String]) -> Result<i64, String> {
            unimplemented!()
        }
        fn list_labels(&self) -> Result<Vec<String>, String> {
            unimplemented!()
        }
        fn mark_deleted(&mut self, _path: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn move_record(&mut self, _from: &str, _to: &str, _state: &str) -> Result<(), String> {
            unimplemented!()
        }
        fn mark_under_roots_deleted(&mut self, _roots: &[String]) -> Result<i64, String> {
            unimplemented!()
        }
        fn insert_archive_op(&mut self, _op: &ArchiveOp) -> Result<i64, String> {
            unimplemented!()
        }
        fn list_archive_batches(&self, _limit: i64) -> Result<Vec<ArchiveBatch>, String> {
            unimplemented!()
        }
        fn ops_for_batch(&self, _batch_id: i64) -> Result<Vec<ArchiveOp>, String> {
            unimplemented!()
        }
        fn mark_ops_undone(&mut self, _ids: &[i64]) -> Result<(), String> {
            unimplemented!()
        }
        fn upsert_shortcut(
            &mut self,
            _lnk_path: &str,
            _target_path: &str,
            _created_at: i64,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn shortcuts_under(&self, _root: &str) -> Result<Vec<ShortcutRecord>, String> {
            unimplemented!()
        }
        fn update_shortcut_target(
            &mut self,
            _lnk_path: &str,
            _target_path: &str,
        ) -> Result<(), String> {
            unimplemented!()
        }
        fn count(&self) -> Result<i64, String> {
            unimplemented!()
        }
    }

    #[test]
    fn archive_file_rolls_back_disk_when_db_update_fails() {
        let dir = temp_dir("archive_rollback");
        let downloads = dir.join("Downloads");
        let archive = dir.join("Archive");
        fs::create_dir_all(&downloads).unwrap();
        let src = downloads.join("a.pdf");
        fs::write(&src, "x").unwrap();
        let src_str = normalize_path(&src.to_string_lossy());
        let archive_str = normalize_path(&archive.to_string_lossy());
        let store: Arc<Mutex<dyn IndexStore>> = Arc::new(Mutex::new(FailingArchiveStore {
            record: indexed(&src_str, "document"),
            fail_archive: true,
            fail_unarchive: false,
        }));

        let outcome =
            archive_files(&store, &archive_str, std::slice::from_ref(&src_str), 1).unwrap();
        assert_eq!(outcome.archived, 0);
        assert_eq!(outcome.failed.len(), 1);
        assert!(src.exists(), "DB 更新失败后文件应被移回原位置");
        assert!(!archive.join("document").join("a.pdf").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn undo_file_rolls_back_disk_when_db_update_fails() {
        let dir = temp_dir("undo_rollback");
        let dest = dir.join("a.pdf");
        let back = dir.join("back");
        fs::create_dir_all(&back).unwrap();
        fs::write(&dest, "x").unwrap();
        let dest_str = normalize_path(&dest.to_string_lossy());
        let source_str = normalize_path(&back.join("a.pdf").to_string_lossy());
        let store: Arc<Mutex<dyn IndexStore>> = Arc::new(Mutex::new(FailingArchiveStore {
            record: FileRecord::new(&dest_str, 10, 1, "archived"),
            fail_archive: false,
            fail_unarchive: true,
        }));
        let op = ArchiveOp {
            id: 7,
            batch_id: 1,
            kind: "file".into(),
            source: source_str.clone(),
            dest: dest_str.clone(),
            created_at: 1,
            undone_at: None,
        };

        let err = undo_one_file(&store, &op).unwrap_err();
        assert!(err.contains("已还原"), "错误应说明已回滚: {err}");
        assert!(dest.exists(), "撤销失败后文件应留在归档目标");
        assert!(!Path::new(&source_str).exists(), "不应留下半成品源文件");
        let _ = fs::remove_dir_all(&dir);
    }

    fn test_settings(dirs: &[&str]) -> Settings {
        Settings {
            project_dirs: dirs.iter().map(|d| d.to_string()).collect(),
            ..Settings::default()
        }
    }

    struct RecordingJournal {
        store: Arc<Mutex<dyn IndexStore>>,
        calls: Arc<Mutex<Vec<String>>>,
        fail_save: bool,
        fail_rewrite_target: Option<String>,
        fail_insert: bool,
    }

    impl ProjectJournal for RecordingJournal {
        fn save_settings(&self, settings: &Settings) -> Result<(), String> {
            let mut calls = self.calls.lock().unwrap();
            calls.push(format!("save:{}", settings.project_dirs.join("|")));
            let is_first = calls.len() == 1;
            if self.fail_save && is_first {
                return Err("注入: 设置保存失败".into());
            }
            Ok(())
        }

        fn rewrite_shortcut(
            &self,
            lnk_path: &str,
            target: &str,
            _kind: ProjectKind,
        ) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("rewrite:{lnk_path}->{target}"));
            if self
                .fail_rewrite_target
                .as_deref()
                .is_some_and(|t| t == target)
            {
                return Err("注入: 快捷方式重写失败".into());
            }
            Ok(())
        }

        fn update_shortcut_target(&self, lnk_path: &str, target: &str) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("update:{lnk_path}->{target}"));
            self.store
                .lock()
                .map_err(|e| e.to_string())?
                .update_shortcut_target(lnk_path, target)
        }

        fn insert_archive_op(&self, op: &ArchiveOp) -> Result<(), String> {
            self.calls.lock().unwrap().push("insert".into());
            if self.fail_insert {
                return Err("注入: 日志写入失败".into());
            }
            self.store
                .lock()
                .map_err(|e| e.to_string())?
                .insert_archive_op(op)
                .map(|_| ())
        }
    }

    type JournalFixture = (
        std::path::PathBuf,
        std::path::PathBuf,
        Arc<Mutex<dyn IndexStore>>,
        ProjectSideEffects,
        Arc<Mutex<Vec<String>>>,
    );

    fn project_journal_fixture(tag: &str) -> JournalFixture {
        let dir = temp_dir(tag);
        let source = dir.join("proj");
        let dest = dir.join("Archive").join("proj");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(source.join("a.txt"), "x").unwrap();

        let store = store();
        {
            let mut guard = store.lock().unwrap();
            guard
                .upsert_shortcut("C:/lnk1.lnk", &normalize_path(&source.to_string_lossy()), 1)
                .unwrap();
            guard
                .upsert_shortcut(
                    "C:/lnk2.lnk",
                    &normalize_path(&source.join("sub").to_string_lossy()),
                    2,
                )
                .unwrap();
        }

        let source_str = normalize_path(&source.to_string_lossy());
        let dest_str = normalize_path(&dest.to_string_lossy());
        let effects = ProjectSideEffects {
            settings: test_settings(&[&dest_str]),
            settings_backup: test_settings(&[&source_str]),
            links: vec![
                ProjectLinkEffect {
                    lnk_path: "C:/lnk1.lnk".into(),
                    original_target: source_str.clone(),
                    new_target: dest_str.clone(),
                },
                ProjectLinkEffect {
                    lnk_path: "C:/lnk2.lnk".into(),
                    original_target: format!("{source_str}/sub"),
                    new_target: format!("{dest_str}/sub"),
                },
            ],
            kind: ProjectKind::Generic,
            insert_op: Some(ArchiveOp {
                id: 0,
                batch_id: 42,
                kind: "project".into(),
                source: source_str.clone(),
                dest: dest_str.clone(),
                created_at: 1,
                undone_at: None,
            }),
        };
        (
            source,
            dest,
            store,
            effects,
            Arc::new(Mutex::new(Vec::new())),
        )
    }

    #[test]
    fn project_journal_success_rewrites_links_and_inserts_op() {
        let (source, dest, store, effects, calls) = project_journal_fixture("journal_ok");
        fs::rename(&source, &dest).unwrap();
        let journal = RecordingJournal {
            store: store.clone(),
            calls: calls.clone(),
            fail_save: false,
            fail_rewrite_target: None,
            fail_insert: false,
        };
        apply_project_journal(
            &effects,
            &journal,
            &normalize_path(&dest.to_string_lossy()),
            &normalize_path(&source.to_string_lossy()),
        )
        .unwrap();

        assert!(dest.exists() && !source.exists());
        assert_eq!(store.lock().unwrap().ops_for_batch(42).unwrap().len(), 1);
        let dest_str = normalize_path(&dest.to_string_lossy());
        let links = store.lock().unwrap().shortcuts_under(&dest_str).unwrap();
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|l| l.target_path.starts_with(&dest_str)));
        let call_count = calls.lock().unwrap().len();
        assert!(
            call_count >= 5,
            "应有保存+重写+登记+日志调用，实际 {call_count}"
        );
        let _ = std::fs::remove_dir_all(dest.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn project_journal_save_failure_rolls_back_everything() {
        let (source, dest, store, effects, calls) = project_journal_fixture("journal_save");
        fs::rename(&source, &dest).unwrap();
        let journal = RecordingJournal {
            store: store.clone(),
            calls: calls.clone(),
            fail_save: true,
            fail_rewrite_target: None,
            fail_insert: false,
        };
        let err = apply_project_journal(
            &effects,
            &journal,
            &normalize_path(&dest.to_string_lossy()),
            &normalize_path(&source.to_string_lossy()),
        )
        .unwrap_err();
        assert!(err.contains("设置保存失败"));

        assert!(source.exists() && !dest.exists(), "目录应被移回原位置");
        let saved = calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.starts_with("save:"))
            .count();
        assert_eq!(saved, 2, "应保存新值一次 + 回滚备份一次");
        assert!(store.lock().unwrap().ops_for_batch(42).unwrap().is_empty());
        let links = store
            .lock()
            .unwrap()
            .shortcuts_under(&normalize_path(&source.to_string_lossy()))
            .unwrap();
        assert_eq!(links.len(), 2, "快捷方式目标应保持原样");
        let _ = std::fs::remove_dir_all(source.parent().unwrap());
    }

    #[test]
    fn project_journal_rewrite_failure_rolls_back_all_links_and_dir() {
        let (source, dest, store, effects, calls) = project_journal_fixture("journal_rewrite");
        fs::rename(&source, &dest).unwrap();
        let dest_str = normalize_path(&dest.to_string_lossy());
        let journal = RecordingJournal {
            store: store.clone(),
            calls: calls.clone(),
            fail_save: false,
            fail_rewrite_target: Some(format!("{dest_str}/sub")),
            fail_insert: false,
        };
        let err = apply_project_journal(
            &effects,
            &journal,
            &dest_str,
            &normalize_path(&source.to_string_lossy()),
        )
        .unwrap_err();
        assert!(err.contains("快捷方式重写失败"));

        assert!(source.exists() && !dest.exists(), "目录应被移回原位置");
        let source_str = normalize_path(&source.to_string_lossy());
        let links = store.lock().unwrap().shortcuts_under(&source_str).unwrap();
        assert_eq!(links.len(), 2, "全部快捷方式应还原到原目标");
        assert!(
            links.iter().all(|l| l.target_path.starts_with(&source_str)),
            "回滚后 target 应全部指向原路径"
        );
        assert!(store.lock().unwrap().ops_for_batch(42).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(source.parent().unwrap());
    }

    #[test]
    fn project_journal_insert_failure_rolls_back_everything() {
        let (source, dest, store, effects, calls) = project_journal_fixture("journal_insert");
        fs::rename(&source, &dest).unwrap();
        let journal = RecordingJournal {
            store: store.clone(),
            calls: calls.clone(),
            fail_save: false,
            fail_rewrite_target: None,
            fail_insert: true,
        };
        let err = apply_project_journal(
            &effects,
            &journal,
            &normalize_path(&dest.to_string_lossy()),
            &normalize_path(&source.to_string_lossy()),
        )
        .unwrap_err();
        assert!(err.contains("日志写入失败"));

        assert!(source.exists() && !dest.exists());
        assert!(store.lock().unwrap().ops_for_batch(42).unwrap().is_empty());
        let source_str = normalize_path(&source.to_string_lossy());
        let links = store.lock().unwrap().shortcuts_under(&source_str).unwrap();
        assert_eq!(links.len(), 2);
        let _ = std::fs::remove_dir_all(source.parent().unwrap());
    }

    #[test]
    fn archive_and_undo_file_roundtrip() {
        let dir = temp_dir("roundtrip");
        let downloads = dir.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let src = downloads.join("a.pdf");
        fs::write(&src, "x").unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        store
            .lock()
            .unwrap()
            .upsert(&indexed(
                &normalize_path(&src.to_string_lossy()),
                "document",
            ))
            .unwrap();

        let paths = vec![normalize_path(&src.to_string_lossy())];
        let outcome = archive_files(&store, &root, &paths, 100).unwrap();
        assert_eq!(outcome.archived, 1);
        assert!(!src.exists());
        let dest = dir.join("Archive/document/a.pdf");
        assert!(dest.exists());
        let rec = store
            .lock()
            .unwrap()
            .get_by_path(&normalize_path(&dest.to_string_lossy()))
            .unwrap()
            .unwrap();
        assert_eq!(rec.state, "archived");

        let undo = undo_file_batch(&store, 100).unwrap();
        assert_eq!(undo.archived, 1);
        assert!(src.exists());
        let rec = store
            .lock()
            .unwrap()
            .get_by_path(&normalize_path(&src.to_string_lossy()))
            .unwrap()
            .unwrap();
        assert_eq!(rec.state, "indexed");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn batch_partial_failure_keeps_success_and_undo_restores_only_success() {
        let dir = temp_dir("partial");
        let downloads = dir.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let good = downloads.join("a.pdf");
        fs::write(&good, "x").unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        store
            .lock()
            .unwrap()
            .upsert(&indexed(
                &normalize_path(&good.to_string_lossy()),
                "document",
            ))
            .unwrap();

        let missing = dir.join("Downloads/ghost.pdf");
        let outcome = archive_files(
            &store,
            &root,
            &[
                normalize_path(&good.to_string_lossy()),
                normalize_path(&missing.to_string_lossy()),
            ],
            101,
        )
        .unwrap();
        assert_eq!(outcome.archived, 1);
        assert_eq!(outcome.failed.len(), 1);
        assert!(outcome.failed[0].error.contains("不在索引中"));

        let undo = undo_file_batch(&store, 101).unwrap();
        assert_eq!(undo.archived, 1);
        assert!(good.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn collision_appends_number_without_overwrite() {
        let dir = temp_dir("collision");
        let downloads = dir.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        fs::create_dir_all(dir.join("Archive/document")).unwrap();
        let src = downloads.join("a.pdf");
        fs::write(&src, "new").unwrap();
        fs::write(dir.join("Archive/document/a.pdf"), "old").unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        store
            .lock()
            .unwrap()
            .upsert(&indexed(
                &normalize_path(&src.to_string_lossy()),
                "document",
            ))
            .unwrap();

        let outcome = archive_files(
            &store,
            &root,
            &[normalize_path(&src.to_string_lossy())],
            102,
        )
        .unwrap();
        assert_eq!(outcome.archived, 1);
        assert_eq!(
            fs::read_to_string(dir.join("Archive/document/a.pdf")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(dir.join("Archive/document/a (2).pdf")).unwrap(),
            "new"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pending_and_archived_records_are_rejected() {
        let dir = temp_dir("state");
        let downloads = dir.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let src = downloads.join("a.pdf");
        fs::write(&src, "x").unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        let mut pending = indexed(&normalize_path(&src.to_string_lossy()), "document");
        pending.state = "pending".to_string();
        store.lock().unwrap().upsert(&pending).unwrap();
        let outcome = archive_files(
            &store,
            &root,
            &[normalize_path(&src.to_string_lossy())],
            200,
        )
        .unwrap();
        assert_eq!(outcome.archived, 0);
        assert!(outcome.failed[0].error.contains("状态不是已索引"));
        assert!(src.exists());

        // 归档成功后再次归档同一文件（状态为 archived）应被拒绝
        store
            .lock()
            .unwrap()
            .upsert(&indexed(&normalize_path(&src.to_string_lossy()), "indexed"))
            .unwrap();
        let first = archive_files(
            &store,
            &root,
            &[normalize_path(&src.to_string_lossy())],
            201,
        )
        .unwrap();
        assert_eq!(first.archived, 1);
        let second = archive_files(
            &store,
            &root,
            &[normalize_path(&src.to_string_lossy())],
            202,
        )
        .unwrap();
        assert_eq!(second.archived, 0);
        assert!(
            second.failed[0].error.contains("状态不是已索引")
                || second.failed[0].error.contains("不在索引中")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn undo_refuses_when_original_path_occupied() {
        let dir = temp_dir("occupied");
        let downloads = dir.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let src = downloads.join("a.pdf");
        fs::write(&src, "x").unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        store
            .lock()
            .unwrap()
            .upsert(&indexed(
                &normalize_path(&src.to_string_lossy()),
                "document",
            ))
            .unwrap();
        archive_files(
            &store,
            &root,
            &[normalize_path(&src.to_string_lossy())],
            300,
        )
        .unwrap();
        assert!(!src.exists());

        // 原位置被新文件占用：撤销应拒绝且不破坏任何一方
        fs::write(&src, "new file").unwrap();
        let undo = undo_file_batch(&store, 300).unwrap();
        assert_eq!(undo.archived, 0);
        assert!(undo.failed[0].error.contains("原位置已有文件"));
        assert_eq!(fs::read_to_string(&src).unwrap(), "new file");
        assert!(dir.join("Archive/document/a.pdf").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
