//! 软件单元同步：把 `discover_software` 的发现结果派生写入 units 索引（kind=software）。
//!
//! 发现逻辑（core/software.rs）是唯一真源，units 只是查询派生层：
//! 不在最新发现集合内的历史 software 单元标记 deleted（索引保留，可重扫恢复）。
//! 同步在启动（延迟服务）与软件目录裁决变更后触发，均为后台执行不阻塞交互。
use crate::core::events::FileState;
use crate::core::index::{FileRecord, IndexStore, UnitKind};
use crate::core::path::path_key;
use crate::core::query::parse_query;
use crate::core::software::{discover_software, DirProbe, FsProbe};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// 后台同步软件单元到 units 索引（发现逻辑是唯一真源，units 是派生查询层）。
/// 供命令层（裁决变更后）与启动延迟服务调用；同步在独立线程执行。
pub fn schedule_software_sync(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let store = app
            .try_state::<Arc<Mutex<dyn IndexStore>>>()
            .map(|s| s.inner().clone());
        let Some(store) = store else {
            return;
        };
        let settings = crate::infra::storage::load_settings(&app);
        match sync_software_units(
            &store,
            &settings.watched_dirs,
            &settings.software_dirs,
            &settings.software_excluded,
            &FsProbe,
        ) {
            Ok(summary) => {
                log::info!(
                    "software-sync: upsert={} removed={}",
                    summary.upserted,
                    summary.removed
                )
            }
            Err(e) => log::warn!("software-sync: 失败 {e}"),
        }
    });
}

/// 全量同步软件单元。任何一步失败返回 Err，调用方记录即可（下次同步自愈）。
pub fn sync_software_units(
    store: &Arc<Mutex<dyn IndexStore>>,
    watched: &[String],
    manual: &[String],
    excluded: &[String],
    probe: &dyn DirProbe,
) -> Result<crate::infra::project_sync::SyncSummary, String> {
    let software = discover_software(watched, manual, excluded, probe);
    let mut store = store.lock().map_err(|e| e.to_string())?;

    // 最新发现集合 → software 单元 upsert（name 用目录名，携带识别依据）
    let now = crate::infra::time::now_millis();
    let mut upserts = Vec::with_capacity(software.len());
    let mut live_keys: std::collections::HashSet<String> = Default::default();
    for info in &software {
        let mut record = FileRecord::new(&info.path, 0, now, FileState::Indexed.as_str());
        record.kind = UnitKind::Software;
        record.software_kind = Some(info.detected_by.clone());
        live_keys.insert(path_key(&info.path));
        upserts.push(record);
    }
    store.upsert_many(&upserts)?;

    // 失效清理：现存 software 单元不在最新集合 → deleted
    let mut query = parse_query("kind:software state:indexed");
    query.need_total = false;
    query.limit = 10_000;
    let page = store.query(&query)?;
    let mut removed = 0usize;
    for stale in &page.items {
        if !live_keys.contains(&path_key(&stale.path)) {
            store.mark_deleted(&stale.path)?;
            removed += 1;
        }
    }

    Ok(crate::infra::project_sync::SyncSummary {
        upserted: upserts.len(),
        removed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::index_store::SqliteIndexStore;
    use std::collections::HashMap;

    /// 内存探针：dir -> (child -> is_dir)。
    struct MemProbe(HashMap<String, Vec<(String, bool)>>);

    impl MemProbe {
        fn add_dir(&mut self, dir: &str, children: &[(&str, bool)]) {
            self.0.insert(
                dir.to_string(),
                children.iter().map(|(n, d)| (n.to_string(), *d)).collect(),
            );
        }
    }

    impl DirProbe for MemProbe {
        fn child_names(&self, dir: &str) -> Vec<String> {
            self.0
                .get(dir)
                .map(|c| c.iter().map(|(n, _)| n.clone()).collect())
                .unwrap_or_default()
        }
        fn is_dir(&self, dir: &str, child: &str) -> bool {
            self.0
                .get(dir)
                .and_then(|c| c.iter().find(|(n, _)| n == child))
                .map(|(_, d)| *d)
                .unwrap_or(false)
        }
    }

    fn mem_store() -> Arc<Mutex<dyn IndexStore>> {
        Arc::new(Mutex::new(
            SqliteIndexStore::open(":memory:").expect("in-memory store"),
        ))
    }

    #[test]
    fn sync_upserts_software_units_with_detection_kind() {
        let store = mem_store();
        let mut probe = MemProbe(HashMap::new());
        probe.add_dir("C:/Watch", &[("SomeApp", true), ("Docs", true)]);
        probe.add_dir(
            "C:/Watch/SomeApp",
            &[("SomePortable.exe", false), ("App", true)],
        );
        let summary = sync_software_units(&store, &["C:/Watch".to_string()], &[], &[], &probe)
            .expect("sync ok");
        assert_eq!(summary.upserted, 1);
        assert_eq!(summary.removed, 0);

        let mut query = parse_query("kind:software");
        query.need_total = false;
        let page = store.lock().unwrap().query(&query).unwrap();
        assert_eq!(page.items.len(), 1);
        let unit = &page.items[0];
        assert_eq!(unit.name, "SomeApp");
        assert_eq!(unit.kind, UnitKind::Software);
        assert_eq!(
            unit.software_kind.as_deref(),
            Some(crate::core::software::DETECTED_PAF)
        );
    }

    #[test]
    fn resync_marks_stale_units_deleted_and_keeps_first_seen() {
        let store = mem_store();
        let mut probe = MemProbe(HashMap::new());
        probe.add_dir("C:/Watch", &[("tool", true)]);
        probe.add_dir("C:/Watch/tool", &[("tool.exe", false), ("Data", true)]);
        sync_software_units(&store, &["C:/Watch".to_string()], &[], &[], &probe)
            .expect("first sync");

        let first = {
            let mut query = parse_query("kind:software");
            query.need_total = false;
            let page = store.lock().unwrap().query(&query).unwrap();
            page.items[0].clone()
        };

        // 第二轮：目录消失 → 单元标记 deleted
        let probe = MemProbe(HashMap::new());
        let summary = sync_software_units(&store, &["C:/Watch".to_string()], &[], &[], &probe)
            .expect("second sync");
        assert_eq!(summary.removed, 1);
        let mut query = parse_query("kind:software");
        query.need_total = false;
        let page = store.lock().unwrap().query(&query).unwrap();
        assert_eq!(page.items.len(), 0, "默认查询不返回 deleted 单元");

        // 目录回来 → 重扫恢复，first_seen 保留首次发现时间
        let mut probe = MemProbe(HashMap::new());
        probe.add_dir("C:/Watch", &[("tool", true)]);
        probe.add_dir("C:/Watch/tool", &[("tool.exe", false), ("Data", true)]);
        sync_software_units(&store, &["C:/Watch".to_string()], &[], &[], &probe)
            .expect("third sync");
        let mut query = parse_query("kind:software");
        query.need_total = false;
        let page = store.lock().unwrap().query(&query).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(
            page.items[0].first_seen, first.first_seen,
            "first_seen 保留"
        );
    }
}
