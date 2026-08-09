//! USN 启动补账（0.8.6 阶段一）：把应用关闭期间/漏掉的变更一次性对齐到索引。
//!
//! 语义与 0.8.4 重命名收敛一致：旧路径删除、新路径入库；
//! 运行期以 notify 为主，本模块只在启动时执行一次，不轮询。

use crate::core::delta::DeltaSource;
use crate::core::delta::{DeltaKind, DeltaRecord};
use crate::core::index::IndexStore;
use crate::core::path::{normalize_path, path_key};
use crate::infra::ntfs::{drive_root_of, read_usn_delta, resolve_delta_paths, UsnRecord};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// 把 USN 原始记录映射为增量事件（纯函数，可单测）。
/// 路径仅保留监控根之下的记录；重命名按“旧路径删除 + 新路径创建”展开。
pub fn map_usn_records(records: &[UsnRecord], drive: &str, roots: &[String]) -> Vec<DeltaRecord> {
    let paths = resolve_delta_paths(records, drive);
    let under_root = |path: &str| -> bool {
        let key = path_key(path);
        roots
            .iter()
            .any(|root| key.starts_with(&path_key(root)) || root == path)
    };
    let mut out: Vec<DeltaRecord> = Vec::new();
    for record in records {
        let Some(path) = paths.get(&record.file_ref) else {
            continue;
        };
        if !under_root(path) || roots.iter().any(|root| root == path) {
            continue;
        }
        let reason = record.reason;
        if reason
            & (crate::infra::ntfs::USN_REASON_FILE_DELETE
                | crate::infra::ntfs::USN_REASON_RENAME_OLD_NAME)
            != 0
        {
            out.push(DeltaRecord::deleted(path.clone()));
        } else if reason & 0x100 != 0 {
            // USN_REASON_FILE_CREATE
            out.push(DeltaRecord::created(path.clone()));
        } else {
            out.push(DeltaRecord {
                kind: DeltaKind::Modified,
                path: path.clone(),
                new_path: None,
                size: None,
                modified_ms: Some(record.modified_ms),
            });
        }
    }
    out
}

fn fetch_metadata(path: &str) -> Option<(i64, i64, bool)> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some((meta.len() as i64, modified, meta.is_dir()))
}

/// 对每个监控根执行一次启动补账（幂等由调用方保证）；任何失败只记录不阻塞。
pub fn run_usn_catchup(
    store: Arc<Mutex<dyn IndexStore>>,
    watched_dirs: &[String],
) -> Result<(usize, usize), String> {
    let mut volumes: HashMap<String, Vec<String>> = HashMap::new();
    for dir in watched_dirs {
        let Some(drive) = drive_root_of(dir) else {
            continue;
        };
        volumes.entry(drive).or_default().push(normalize_path(dir));
    }
    let mut applied = 0usize;
    let mut deleted = 0usize;
    for (drive, roots) in volumes {
        let mut source = UsnDeltaSource::new(drive.clone(), roots, store.clone());
        if let Err(e) = source.begin() {
            log::info!("usn: 补账不可用 volume={drive} reason={e}");
            continue;
        }
        while let Some(delta) = source.next().map_err(|e| e.to_string())? {
            match delta.kind {
                DeltaKind::Deleted => {
                    store
                        .lock()
                        .map_err(|e| e.to_string())?
                        .mark_deleted(&delta.path)?;
                    deleted += 1;
                }
                DeltaKind::Created | DeltaKind::Modified | DeltaKind::Renamed => {
                    let Some((size, modified_ms, is_dir)) = fetch_metadata(&delta.path) else {
                        // 文件已不存在（创建后被删除）→ 标记删除
                        store
                            .lock()
                            .map_err(|e| e.to_string())?
                            .mark_deleted(&delta.path)?;
                        deleted += 1;
                        continue;
                    };
                    if is_dir {
                        continue;
                    }
                    let mut record = crate::core::index::FileRecord::new(
                        &delta.path,
                        size,
                        modified_ms,
                        "indexed",
                    );
                    record.modified = modified_ms;
                    store.lock().map_err(|e| e.to_string())?.upsert(&record)?;
                    applied += 1;
                }
            }
        }
        source.commit()?;
        let count = source.record_count();
        log::info!(
            "usn: 补账 volume={drive} records={} applied={applied} deleted={deleted}",
            count
        );
    }
    Ok((applied, deleted))
}

/// USN 增量数据源：begin 读取 (last, current] 并映射为 DeltaRecord，
/// commit 落库游标；无基线时 begin 直接记录当前 USN（全量扫描已入队）。
pub struct UsnDeltaSource {
    drive: String,
    roots: Vec<String>,
    store: Arc<Mutex<dyn IndexStore>>,
    deltas: std::collections::VecDeque<DeltaRecord>,
    current: u64,
}

impl UsnDeltaSource {
    pub fn new(drive: String, roots: Vec<String>, store: Arc<Mutex<dyn IndexStore>>) -> Self {
        Self {
            drive,
            roots,
            store,
            deltas: std::collections::VecDeque::new(),
            current: 0,
        }
    }

    pub fn record_count(&self) -> usize {
        self.deltas.len()
    }
}

impl DeltaSource for UsnDeltaSource {
    fn begin(&mut self) -> Result<(), String> {
        let last = self
            .store
            .lock()
            .map_err(|e| e.to_string())?
            .get_last_usn(&self.drive)?;
        let (records, current) = match last {
            Some(last) => read_usn_delta(&self.drive, last as u64)?,
            None => {
                let current = crate::infra::ntfs::current_usn(&self.drive)?;
                self.store
                    .lock()
                    .map_err(|e| e.to_string())?
                    .set_last_usn(&self.drive, current as i64)?;
                log::info!("usn: 建立基线 volume={} usn={current}", self.drive);
                return Ok(());
            }
        };
        self.current = current;
        self.deltas = map_usn_records(&records, &self.drive, &self.roots).into();
        Ok(())
    }

    fn next(&mut self) -> Result<Option<DeltaRecord>, String> {
        Ok(self.deltas.pop_front())
    }

    fn commit(&mut self) -> Result<(), String> {
        if self.current > 0 {
            self.store
                .lock()
                .map_err(|e| e.to_string())?
                .set_last_usn(&self.drive, self.current as i64)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::ntfs::USN_REASON_FILE_DELETE;

    fn rec(file_ref: u64, parent: u64, reason: u32, name: &str) -> UsnRecord {
        UsnRecord {
            file_ref,
            parent_ref: parent,
            usn: file_ref,
            reason,
            modified_ms: 1_700_000_000_000,
            name: name.to_string(),
        }
    }

    #[test]
    fn maps_created_modified_deleted_and_filters_roots() {
        let records = vec![
            rec(1, 2, 0x100, "a.txt"),                     // create
            rec(1, 2, 0x1, "a.txt"),                       // data overwrite
            rec(3, 2, USN_REASON_FILE_DELETE, "gone.txt"), // delete
            rec(4, 5, 0x100, "outside.txt"),
        ];
        let drive = "C:";
        let roots = vec!["C:/root".to_string()];
        // 先构造父链记录（root=2 的父为 0）
        let mut all = vec![rec(2, 0, 0x100, "root"), rec(5, 0, 0x100, "other")];
        all.extend(records);
        let deltas = map_usn_records(&all, drive, &roots);
        let kinds: Vec<DeltaKind> = deltas.iter().map(|d| d.kind).collect();
        assert!(kinds.contains(&DeltaKind::Created));
        assert!(kinds.contains(&DeltaKind::Modified));
        assert!(kinds.contains(&DeltaKind::Deleted));
        assert!(deltas.iter().all(|d| d.path.starts_with("C:/root/")));
        assert!(
            deltas.iter().all(|d| !d.path.contains("outside")),
            "监控根之外的记录应被过滤"
        );
    }
}
