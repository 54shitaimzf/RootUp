//! 归档引擎：文件级移动 + 索引迁移 + 操作日志（不依赖 Tauri，可测试）。
use crate::core::archive::{
    move_error, plan_file_target, target_collides, unique_dest, ArchiveFailure, ArchiveOp,
    ArchiveOutcome, UNDO_KEEP_BATCHES,
};
use crate::core::index::IndexStore;
use crate::core::path::normalize_path;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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
    let journal_result = (|| -> Result<(), String> {
        let mut store = store.lock().map_err(|e| e.to_string())?;
        store.move_record(&path, &dest_str, "archived")?;
        store.insert_archive_op(&ArchiveOp {
            id: 0,
            batch_id,
            kind: "file".to_string(),
            source: path.clone(),
            dest: dest_str.clone(),
            created_at: now_millis(),
            undone_at: None,
        })?;
        Ok(())
    })();
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
    let mut done_ids: Vec<i64> = Vec::new();
    for op in ops {
        if op.kind != "file" || op.undone_at.is_some() {
            continue;
        }
        match undo_one_file(store, &op) {
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
    store
        .lock()
        .map_err(|e| e.to_string())?
        .move_record(&op.dest, &op.source, "indexed")?;
    log::info!("archive: 撤销 file={} <- {}", op.source, op.dest);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
