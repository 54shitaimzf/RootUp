//! 启动可靠性加固（0.8.8）：归档对账 + 残留临时文件清理。
//!
//! 对账口径：磁盘是真源，索引向磁盘看齐（按 source/dest 存在性四象限）；
//! 对账与清理均在启动延迟服务后台执行，失败只记日志不阻塞启动。
use crate::core::archive::ArchiveOp;
use crate::core::events::FileState;
use crate::core::index::IndexStore;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// 对账结果（日志用）。
#[derive(Debug, Default, PartialEq)]
pub struct ReconcileSummary {
    pub checked: usize,
    /// 索引按磁盘真源补正的记录数
    pub fixed: usize,
    /// 标记异常的操作数（手工还原 / 两侧皆失）
    pub anomaly: usize,
}

/// 启动归档对账：核对最近批次（未撤销）的 source/dest 存在性并修复索引。
///
/// - dest 在、source 不在：归档完成态。索引若仍停在源路径（半写），补迁移到 archived；
/// - dest 不在、source 在：磁盘已还原（手工还原或移动中断）。索引 archived 记录迁回
///   indexed，操作标记 undone（异常自愈）；
/// - 两侧皆在：用户复制回来的场景，保持原样不动作；
/// - 两侧皆失：用户删除了归档目标。索引 archived 记录标 deleted，操作标记异常。
pub fn reconcile_archive_ops(
    store: &Arc<Mutex<dyn IndexStore>>,
    recent_batches: i64,
) -> Result<ReconcileSummary, String> {
    let mut summary = ReconcileSummary::default();
    let batches = store
        .lock()
        .map_err(|e| e.to_string())?
        .list_archive_batches(recent_batches)?;
    for batch in &batches {
        let ops = store
            .lock()
            .map_err(|e| e.to_string())?
            .ops_for_batch(batch.batch_id)?;
        for op in ops {
            if op.undone_at.is_some() {
                continue;
            }
            summary.checked += 1;
            let dest_exists = Path::new(&op.dest).exists();
            let source_exists = Path::new(&op.source).exists();
            match (dest_exists, source_exists) {
                (true, false) => {
                    if fix_archived_moved(store, &op)? {
                        summary.fixed += 1;
                    }
                }
                (false, true) => {
                    fix_restored(store, &op)?;
                    summary.anomaly += 1;
                }
                (false, false) => {
                    fix_vanished(store, &op)?;
                    summary.anomaly += 1;
                }
                (true, true) => {}
            }
        }
    }
    Ok(summary)
}

/// 归档完成态：索引记录仍留在源路径（上次会话半写）→ 补迁移到 archived。
fn fix_archived_moved(store: &Arc<Mutex<dyn IndexStore>>, op: &ArchiveOp) -> Result<bool, String> {
    let mut locked = store.lock().map_err(|e| e.to_string())?;
    let stale = match locked.get_by_path(&op.source)? {
        Some(record) if record.state != FileState::Deleted.as_str() => record,
        _ => return Ok(false),
    };
    let _ = stale;
    locked.move_record(&op.source, &op.dest, "archived")?;
    Ok(true)
}

/// 磁盘已还原：archived 记录迁回源路径 indexed + 操作标记 undone。
fn fix_restored(store: &Arc<Mutex<dyn IndexStore>>, op: &ArchiveOp) -> Result<(), String> {
    let mut locked = store.lock().map_err(|e| e.to_string())?;
    if locked
        .get_by_path(&op.dest)?
        .map(|r| r.state == "archived")
        .unwrap_or(false)
    {
        locked.move_record(&op.dest, &op.source, "indexed")?;
    }
    locked.mark_ops_undone(&[op.id])
}

/// 两侧皆失：archived 记录标 deleted + 操作标记 undone（避免撤销时误判冲突）。
fn fix_vanished(store: &Arc<Mutex<dyn IndexStore>>, op: &ArchiveOp) -> Result<(), String> {
    let mut locked = store.lock().map_err(|e| e.to_string())?;
    if locked
        .get_by_path(&op.dest)?
        .map(|r| r.state == "archived")
        .unwrap_or(false)
    {
        locked.mark_deleted(&op.dest)?;
    }
    locked.mark_ops_undone(&[op.id])
}

/// 清理目录中的 `*.json.tmp` 残留（进程被强杀时半写文件），返回删除数。
/// 仅删精确后缀 `*.json.tmp`，不触碰其他临时文件。
pub fn cleanup_tmp_json(dirs: &[PathBuf]) -> usize {
    let mut removed = 0usize;
    for dir in dirs {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
            let is_tmp = name
                .as_deref()
                .map(|n| n.ends_with(".json.tmp"))
                .unwrap_or(false);
            if is_tmp && path.is_file() {
                match std::fs::remove_file(&path) {
                    Ok(()) => removed += 1,
                    Err(e) => log::warn!("cleanup: 删除临时文件失败 {}: {e}", path.display()),
                }
            }
        }
    }
    if removed > 0 {
        log::info!("cleanup: 清理 *.json.tmp 残留 count={removed}");
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::archive::ArchiveOp;
    use crate::core::index::{FileRecord, IndexStore};
    use crate::infra::index_store::SqliteIndexStore;
    use crate::infra::time::now_millis;

    fn mem_store() -> Arc<Mutex<dyn IndexStore>> {
        Arc::new(Mutex::new(
            SqliteIndexStore::open(":memory:").expect("in-memory store"),
        ))
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_reconcile_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn record(path: &str, state: &str, now: i64) -> FileRecord {
        let mut r = FileRecord::new(path, 1, now, state);
        r.state = state.to_string();
        r
    }

    fn op(id: i64, batch: i64, source: &str, dest: &str) -> ArchiveOp {
        ArchiveOp {
            id,
            batch_id: batch,
            kind: "file".to_string(),
            source: source.to_string(),
            dest: dest.to_string(),
            created_at: now_millis(),
            undone_at: None,
        }
    }

    fn seed_archive(store: &Arc<Mutex<dyn IndexStore>>, op: &ArchiveOp, now: i64) {
        let mut s = store.lock().unwrap();
        s.upsert(&record(&op.source, "indexed", now)).unwrap();
        s.archive_record(&op.source, &op.dest, op).unwrap();
    }

    #[test]
    fn consistent_archive_needs_no_fix() {
        let store = mem_store();
        let dir = temp_dir("consistent");
        let source = dir.join("a.txt");
        let dest_dir = dir.join("archive");
        std::fs::write(&source, b"x").unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        let dest = dest_dir.join("a.txt");
        std::fs::rename(&source, &dest).unwrap();
        let operation = op(1, 1, &source.to_string_lossy(), &dest.to_string_lossy());
        seed_archive(&store, &operation, 100);

        let summary = reconcile_archive_ops(&store, 50).unwrap();
        assert_eq!(
            summary,
            ReconcileSummary {
                checked: 1,
                fixed: 0,
                anomaly: 0
            }
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn half_write_source_still_indexed_gets_migrated() {
        let store = mem_store();
        let dir = temp_dir("halfwrite");
        let source = dir.join("b.txt");
        let dest_dir = dir.join("archive");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let dest = dest_dir.join("b.txt");
        std::fs::write(&dest, b"x").unwrap();
        let operation = op(2, 2, &source.to_string_lossy(), &dest.to_string_lossy());
        // 模拟半写：索引记录仍停留在源路径（indexed）
        store
            .lock()
            .unwrap()
            .upsert(&record(&source.to_string_lossy(), "indexed", 100))
            .unwrap();
        store.lock().unwrap().insert_archive_op(&operation).unwrap();

        let summary = reconcile_archive_ops(&store, 50).unwrap();
        assert_eq!(summary.fixed, 1);
        let s = store.lock().unwrap();
        assert!(s.get_by_path(&source.to_string_lossy()).unwrap().is_none());
        let moved = s.get_by_path(&dest.to_string_lossy()).unwrap().unwrap();
        assert_eq!(moved.state, "archived");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manual_restore_marks_index_back_and_op_undone() {
        let store = mem_store();
        let dir = temp_dir("restore");
        let source = dir.join("c.txt");
        std::fs::write(&source, b"x").unwrap();
        let dest = dir.join("archive").join("c.txt");
        let operation = op(3, 3, &source.to_string_lossy(), &dest.to_string_lossy());
        seed_archive(&store, &operation, 100);
        // 用户手工还原：dest 消失，source 回到磁盘

        let summary = reconcile_archive_ops(&store, 50).unwrap();
        assert_eq!(summary.anomaly, 1);
        let s = store.lock().unwrap();
        let restored = s.get_by_path(&source.to_string_lossy()).unwrap().unwrap();
        assert_eq!(restored.state, "indexed");
        assert!(s.ops_for_batch(3).unwrap()[0].undone_at.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn vanished_both_sides_marks_deleted_and_anomaly() {
        let store = mem_store();
        let dir = temp_dir("vanished");
        let source = dir.join("d.txt");
        let dest = dir.join("archive").join("d.txt");
        let operation = op(4, 4, &source.to_string_lossy(), &dest.to_string_lossy());
        seed_archive(&store, &operation, 100);
        // 两侧皆失：不创建任何文件

        let summary = reconcile_archive_ops(&store, 50).unwrap();
        assert_eq!(summary.anomaly, 1);
        let s = store.lock().unwrap();
        let gone = s.get_by_path(&dest.to_string_lossy()).unwrap().unwrap();
        assert_eq!(gone.state, "deleted");
        assert!(s.ops_for_batch(4).unwrap()[0].undone_at.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_removes_only_json_tmp_files() {
        let dir = temp_dir("tmp");
        std::fs::write(dir.join("settings.json.tmp"), b"half").unwrap();
        std::fs::write(dir.join("labels.json.tmp"), b"half").unwrap();
        std::fs::write(dir.join("labels.json"), b"{}").unwrap();
        std::fs::write(dir.join("other.tmp"), b"keep").unwrap();
        let removed = cleanup_tmp_json(std::slice::from_ref(&dir));
        assert_eq!(removed, 2);
        assert!(dir.join("labels.json").exists());
        assert!(dir.join("other.tmp").exists());
        assert!(!dir.join("settings.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn child_process_strong_kill_does_not_hang() {
        // 子进程强杀中断（集成）：长运行子进程 kill 后 wait 必须立即返回，不挂起
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/C", "ping -n 30 127.0.0.1 > nul"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("spawn child");
        child.kill().expect("kill child");
        let started = std::time::Instant::now();
        let status = child.wait().expect("wait child");
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        // 被强杀的进程必然非成功退出（exit code 非 0 / 异常终止）
        assert!(!status.success());
    }
}
