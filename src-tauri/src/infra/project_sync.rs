//! 项目单元同步：把 `discover_projects` 的发现结果派生写入 units 索引（kind=project）。
//!
//! 发现逻辑（core/project.rs）是唯一真源，units 只是查询派生层：
//! 不在最新发现集合内的历史 project 单元标记 deleted（索引保留，可重扫恢复）。
//! 同步在启动（延迟服务）与目录配置变更后触发，均为后台执行不阻塞交互。
use crate::core::events::FileState;
use crate::core::index::{FileRecord, IndexStore, UnitKind};
use crate::core::path::path_key;
use crate::core::project::{discover_projects, FeatureDetector, ProjectDetector};
use crate::core::query::parse_query;
use crate::infra::storage;
use crate::infra::time::now_millis;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// 后台同步项目单元到 units 索引（发现逻辑是唯一真源，units 是派生查询层）。
/// 供命令层（目录变更后）与启动延迟服务调用；同步在独立线程执行。
pub fn schedule_project_sync(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let store = app
            .try_state::<Arc<Mutex<dyn IndexStore>>>()
            .map(|s| s.inner().clone());
        let Some(store) = store else {
            return;
        };
        let settings = storage::load_settings(&app);
        match sync_project_units(
            &store,
            &settings.watched_dirs,
            &settings.project_dirs,
            &FeatureDetector,
        ) {
            Ok(summary) => {
                log::info!(
                    "project-sync: upsert={} removed={}",
                    summary.upserted,
                    summary.removed
                )
            }
            Err(e) => log::warn!("project-sync: 失败 {e}"),
        }
    });
}

/// 同步结果（日志用）。
pub struct SyncSummary {
    pub upserted: usize,
    pub removed: usize,
}

/// 全量同步项目单元。任何一步失败返回 Err，调用方记录即可（下次同步自愈）。
pub fn sync_project_units(
    store: &Arc<Mutex<dyn IndexStore>>,
    watched: &[String],
    manual: &[String],
    detector: &dyn ProjectDetector,
) -> Result<SyncSummary, String> {
    let projects = discover_projects(watched, manual, detector);
    let mut store = store.lock().map_err(|e| e.to_string())?;

    // 最新发现集合 → project 单元 upsert（name 用目录名，file_type 空）
    let now = now_millis();
    let mut upserts = Vec::with_capacity(projects.len());
    let mut live_keys: std::collections::HashSet<String> = Default::default();
    for project in &projects {
        let mut record = FileRecord::new(&project.path, 0, now, FileState::Indexed.as_str());
        record.kind = UnitKind::Project;
        live_keys.insert(path_key(&project.path));
        upserts.push(record);
    }
    store.upsert_many(&upserts)?;

    // 失效清理：现存 project 单元不在最新集合 → deleted
    let mut query = parse_query("kind:project state:indexed");
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

    Ok(SyncSummary {
        upserted: upserts.len(),
        removed,
    })
}
