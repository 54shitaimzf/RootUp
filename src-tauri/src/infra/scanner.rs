//! 后台扫描服务：串行队列、`FileEnumerator` 遍历、`ScanDiffStore` 差集、删除风暴保护、取消。
use crate::core::classify::Classifier;
use crate::core::index::{FileRecord, ScanDiffStore};
use crate::core::path::{normalize_path, path_key};
use crate::core::scan::{
    record_from_scan, EnumerateStats, FileEntry, FileEnumerator, ScanEvent, ScanEventSink,
    ScanParams, ScanProgress, ScanSummary,
};
use crate::infra::enumerator::WalkDirEnumerator;
use crate::infra::time::now_millis;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// 当前扫描状态（供 `get_scan_status` 查询）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub active: bool,
    pub dir: Option<String>,
    pub discovered: usize,
    pub processed: usize,
    pub ignored: usize,
    pub errors: usize,
    pub queued: usize,
}

/// 线程与外部 API 共享的状态（锁顺序约定：先 queue 后 status）。
struct Shared {
    queue: Mutex<VecDeque<String>>,
    status: Mutex<ScanStatus>,
    cancel: AtomicBool,
    wake: Condvar,
}

/// 后台扫描服务：一次执行一个目录，其余排队；与 Tauri 通过 ScanEventSink 解耦。
pub struct ScanService {
    store: Arc<Mutex<dyn ScanDiffStore>>,
    classifier: Arc<dyn Classifier>,
    params: ScanParams,
    sink: Arc<dyn ScanEventSink>,
    shared: Arc<Shared>,
    thread: Mutex<Option<JoinHandle<()>>>,
    skip_roots: Arc<Mutex<Vec<String>>>,
    enumerator: Arc<dyn FileEnumerator>,
}

impl ScanService {
    pub fn new(
        store: Arc<Mutex<dyn ScanDiffStore>>,
        classifier: Arc<dyn Classifier>,
        matcher: crate::core::ignore::IgnoreMatcher,
        params: ScanParams,
        sink: Arc<dyn ScanEventSink>,
    ) -> Self {
        let skip_roots = Arc::new(Mutex::new(Vec::new()));
        let enumerator = Arc::new(WalkDirEnumerator::new(matcher, skip_roots.clone()));
        Self {
            store,
            classifier,
            params,
            sink,
            shared: Arc::new(Shared {
                queue: Mutex::new(VecDeque::new()),
                status: Mutex::new(ScanStatus::default()),
                cancel: AtomicBool::new(false),
                wake: Condvar::new(),
            }),
            thread: Mutex::new(None),
            skip_roots,
            enumerator,
        }
    }

    /// 更新跳过集（单元根 + 归档根），扫描线程即时生效。
    pub fn update_skip_roots(&self, roots: Vec<String>) {
        if let Ok(mut guard) = self.skip_roots.lock() {
            *guard = roots;
        }
    }

    /// 启动后台线程（幂等）。
    pub fn start(&mut self) {
        if self.thread.lock().unwrap().is_some() {
            return;
        }
        let loop_body = ScanLoop {
            store: self.store.clone(),
            classifier: self.classifier.clone(),
            params: self.params.clone(),
            sink: self.sink.clone(),
            shared: self.shared.clone(),
            enumerator: self.enumerator.clone(),
        };
        let handle = std::thread::Builder::new()
            .name("rootup-scanner".into())
            .spawn(move || loop_body.run_loop())
            .expect("scanner 线程创建失败");
        *self.thread.lock().unwrap() = Some(handle);
    }

    /// 入队一个监控目录（规范化 + 去重）。
    pub fn enqueue(&self, dir: String) {
        let normalized = normalize_path(&dir);
        if normalized.is_empty() {
            return;
        }
        let key = path_key(&normalized);
        let mut queue = self.shared.queue.lock().unwrap();
        if queue.iter().any(|d| path_key(d) == key) {
            return;
        }
        let current = {
            let status = self.shared.status.lock().unwrap();
            status
                .dir
                .as_ref()
                .map(|d| path_key(d) == key)
                .unwrap_or(false)
        };
        if current {
            return;
        }
        queue.push_back(normalized);
        let queued = queue.len();
        drop(queue);
        self.shared.wake.notify_all();
        let mut status = self.shared.status.lock().unwrap();
        status.queued = queued;
    }

    /// 取消当前扫描（已写批次保留、跳过差集）。
    pub fn cancel(&self) {
        self.shared.cancel.store(true, Ordering::SeqCst);
    }

    /// 从队列移除目录；若正在扫描该目录则取消。
    pub fn remove_dir(&self, dir: &str) {
        let key = path_key(dir);
        let mut queue = self.shared.queue.lock().unwrap();
        queue.retain(|d| path_key(d) != key);
        let queued = queue.len();
        drop(queue);
        self.shared.wake.notify_all();
        let mut status = self.shared.status.lock().unwrap();
        status.queued = queued;
        let current = status
            .dir
            .as_ref()
            .map(|d| path_key(d) == key)
            .unwrap_or(false);
        if current {
            self.shared.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// 当前扫描状态快照。
    pub fn status(&self) -> ScanStatus {
        // 锁顺序约定：先 queue 后 status（与 enqueue/remove_dir 一致，避免死锁）
        let queued = self.shared.queue.lock().unwrap().len();
        let mut status = self.shared.status.lock().unwrap().clone();
        status.queued = queued;
        status
    }
}

/// 扫描循环体（Arc 持有，供线程运行）。
struct ScanLoop {
    store: Arc<Mutex<dyn ScanDiffStore>>,
    classifier: Arc<dyn Classifier>,
    params: ScanParams,
    sink: Arc<dyn ScanEventSink>,
    shared: Arc<Shared>,
    enumerator: Arc<dyn FileEnumerator>,
}

impl ScanLoop {
    fn run_loop(&self) {
        let mut queue = self.shared.queue.lock().unwrap();
        loop {
            if let Some(dir) = queue.pop_front() {
                drop(queue);
                self.shared.cancel.store(false, Ordering::SeqCst);
                {
                    let queued = self.shared.queue.lock().unwrap().len();
                    let mut status = self.shared.status.lock().unwrap();
                    status.active = true;
                    status.dir = Some(dir.clone());
                    status.discovered = 0;
                    status.processed = 0;
                    status.ignored = 0;
                    status.errors = 0;
                    status.queued = queued;
                }
                self.scan_dir(&dir);
                {
                    let mut status = self.shared.status.lock().unwrap();
                    status.active = false;
                    status.dir = None;
                }
                queue = self.shared.queue.lock().unwrap();
            } else {
                self.shared.cancel.store(false, Ordering::SeqCst);
                let (guard, _) = self
                    .shared
                    .wake
                    .wait_timeout(queue, Duration::from_millis(1000))
                    .unwrap();
                queue = guard;
            }
        }
    }

    fn scan_dir(&self, dir: &str) {
        let started = Instant::now();
        log::info!("scan: 开始 dir={dir}");

        // 可用性前置检查
        match std::fs::metadata(dir) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => {
                self.fail(dir, "路径不是目录".into());
                return;
            }
            Err(e) => {
                self.fail(dir, format!("目录不可访问: {e}"));
                return;
            }
        }

        // 差集会话：快照与已见集合落在存储层（SQLite 临时表），扫描器内存保持 O(批次)
        if let Err(e) = self
            .store
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|mut s| s.begin_scan_diff(dir))
        {
            self.fail(dir, format!("差集会话启动失败: {e}"));
            return;
        }

        let mut batch: Vec<FileRecord> = Vec::new();
        let mut seen_batch: Vec<String> = Vec::new();
        let mut last_progress = 0usize;
        let mut processed = 0usize;
        let mut cancelled = false;
        let mut flush_errors = 0usize;

        let mut handle_entry = |entry: FileEntry| -> bool {
            if self.shared.cancel.load(Ordering::SeqCst) {
                cancelled = true;
                return false;
            }
            let now_ms = now_millis();
            let record = record_from_scan(
                &entry.path,
                entry.size,
                entry.modified_ms,
                now_ms,
                self.classifier.as_ref(),
            );
            seen_batch.push(path_key(&entry.path));
            batch.push(record);
            if seen_batch.len() >= self.params.batch_size {
                if let Err(e) = self.flush_seen(&mut seen_batch) {
                    flush_errors += 1;
                    log::error!("scan: 写入已见批次失败: {e}");
                }
            }
            if batch.len() >= self.params.batch_size {
                if let Err(e) = self.flush_batch(&mut batch) {
                    flush_errors += 1;
                    log::error!("scan: 写入批次失败: {e}");
                }
            }
            processed += 1;
            if processed - last_progress >= self.params.progress_interval {
                last_progress = processed;
                // 进度阶段 ignored/errors 未知，以已处理数近似展示，最终以 Finished 摘要为准
                self.emit_progress(dir, processed, processed, 0, 0);
            }
            true
        };
        // 快速扫描（实验性，ROOTUP_FAST_SCAN=1 且卷能力/权限满足时启用）；失败一律回退 walkdir
        let fast_entries = crate::infra::ntfs::try_full_scan(dir);
        let enumerate_result = match fast_entries {
            Ok(entries) => {
                let stats = EnumerateStats {
                    discovered: entries.len(),
                    ignored: 0,
                    errors: 0,
                };
                for entry in entries {
                    if !handle_entry(entry) {
                        break;
                    }
                }
                Ok(stats)
            }
            Err(reason) => {
                log::info!("scan: 快速扫描不可用 dir={dir} reason={reason}，回退 walkdir");
                self.enumerator.enumerate(dir, &mut handle_entry)
            }
        };
        let enumerate_stats = match enumerate_result {
            Ok(stats) => stats,
            Err(e) => {
                let _ = self.store.lock().map(|mut s| {
                    let _ = s.finish_scan_diff(
                        self.params.deletion_guard_ratio,
                        self.params.deletion_guard_min as i64,
                    );
                });
                self.fail(dir, format!("遍历失败: {e}"));
                return;
            }
        };

        if let Err(e) = self.flush_seen(&mut seen_batch) {
            flush_errors += 1;
            log::error!("scan: 写入已见批次失败: {e}");
        }
        if let Err(e) = self.flush_batch(&mut batch) {
            flush_errors += 1;
            log::error!("scan: 写入批次失败: {e}");
        }

        let cancelled = cancelled || self.shared.cancel.load(Ordering::SeqCst);
        let discovered = enumerate_stats.discovered;
        let ignored = enumerate_stats.ignored;
        let mut errors = enumerate_stats.errors + flush_errors;
        let elapsed_ms = started.elapsed().as_millis();
        let files_per_sec = if elapsed_ms > 0 {
            (discovered as f64) * 1000.0 / (elapsed_ms as f64)
        } else {
            0.0
        };

        if cancelled {
            // 清理差集临时表并跳过删除标记
            if let Ok(mut s) = self.store.lock() {
                let _ = s.finish_scan_diff(
                    self.params.deletion_guard_ratio,
                    self.params.deletion_guard_min as i64,
                );
            }
            let summary = ScanSummary {
                dir: dir.to_string(),
                discovered,
                added: 0,
                updated: 0,
                ignored,
                errors,
                missing_deleted: 0,
                elapsed_ms,
                files_per_sec,
                cancelled: true,
            };
            log::info!("scan: 取消 dir={dir} elapsed_ms={elapsed_ms}");
            self.sink.on_event(ScanEvent::Cancelled {
                summary: summary.clone(),
            });
            return;
        }

        // 差集：风暴守卫 → 候选二次确认（当前仍存在则不标） → 批量标记
        let diff = self
            .store
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|mut s| {
                s.finish_scan_diff(
                    self.params.deletion_guard_ratio,
                    self.params.deletion_guard_min as i64,
                )
            });
        let mut updated = 0usize;
        let mut missing_deleted = 0i64;
        match diff {
            Ok(summary) => {
                updated = summary.updated;
                if summary.guarded {
                    log::warn!(
                        "scan: 差集跳过 dir={dir} snapshot={} candidates={}",
                        summary.snapshot_total,
                        summary.missing_total
                    );
                } else {
                    let missing: Vec<String> = summary
                        .missing
                        .into_iter()
                        .filter(|p| !Path::new(p).exists())
                        .collect();
                    if !missing.is_empty() {
                        match self.store.lock() {
                            Ok(mut s) => match s.mark_missing(&missing) {
                                Ok(n) => {
                                    missing_deleted = n;
                                    log::info!("scan: 差集 dir={dir} deleted={n}");
                                }
                                Err(e) => {
                                    errors += 1;
                                    log::error!("scan: 差集写入失败 dir={dir}: {e}");
                                }
                            },
                            Err(e) => {
                                errors += 1;
                                log::error!("scan: 差集锁失败 dir={dir}: {e}");
                            }
                        }
                    }
                }
            }
            Err(e) => {
                errors += 1;
                log::error!("scan: 差集会话失败 dir={dir}: {e}");
            }
        }

        // 扫描完成后的轻量维护（SQLite 执行 PRAGMA optimize）
        if let Ok(mut s) = self.store.lock() {
            let _ = s.optimize();
        }

        let added = discovered.saturating_sub(updated);
        let summary = ScanSummary {
            dir: dir.to_string(),
            discovered,
            added,
            updated,
            ignored,
            errors,
            missing_deleted,
            elapsed_ms,
            files_per_sec,
            cancelled: false,
        };
        self.sink.on_event(ScanEvent::Finished {
            summary: summary.clone(),
        });
        log::info!(
            "scan: 完成 dir={dir} discovered={} added={} updated={} ignored={} errors={} missing={} elapsed_ms={} files_per_sec={:.1} cancelled=false",
            summary.discovered,
            summary.added,
            summary.updated,
            summary.ignored,
            summary.errors,
            summary.missing_deleted,
            summary.elapsed_ms,
            summary.files_per_sec
        );
    }

    fn flush_seen(&self, keys: &mut Vec<String>) -> Result<(), String> {
        if keys.is_empty() {
            return Ok(());
        }
        let keys = std::mem::take(keys);
        let mut store = self.store.lock().map_err(|e| e.to_string())?;
        store.mark_scan_seen(&keys)
    }

    fn flush_batch(&self, batch: &mut Vec<FileRecord>) -> Result<(), String> {
        if batch.is_empty() {
            return Ok(());
        }
        let records = std::mem::take(batch);
        let mut store = self.store.lock().map_err(|e| e.to_string())?;
        store.upsert_many(&records)
    }

    fn emit_progress(
        &self,
        dir: &str,
        discovered: usize,
        processed: usize,
        ignored: usize,
        errors: usize,
    ) {
        {
            let mut status = self.shared.status.lock().unwrap();
            status.discovered = discovered;
            status.processed = processed;
            status.ignored = ignored;
            status.errors = errors;
        }
        let progress = ScanProgress {
            dir: dir.to_string(),
            discovered,
            processed,
            ignored,
            errors,
        };
        self.sink.on_event(ScanEvent::Progress { progress });
    }

    fn fail(&self, dir: &str, error: String) {
        log::warn!("scan: 失败 dir={dir} error={error}");
        self.sink.on_event(ScanEvent::Failed {
            dir: dir.to_string(),
            error,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::classify::ExtensionClassifier;
    use crate::core::ignore::IgnoreMatcher;
    use crate::core::index::{FileRecord, IndexStore, ScanDiffStore};
    use crate::infra::index_store::SqliteIndexStore;
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_scan_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct CollectSink(Arc<Mutex<Vec<ScanEvent>>>);

    impl ScanEventSink for CollectSink {
        fn on_event(&self, event: ScanEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    fn test_params() -> ScanParams {
        ScanParams {
            batch_size: 10,
            progress_interval: 5,
            deletion_guard_ratio: 0.25,
            deletion_guard_min: 2,
        }
    }

    fn make_loop(store: Arc<Mutex<dyn ScanDiffStore>>) -> (ScanLoop, Arc<Mutex<Vec<ScanEvent>>>) {
        make_loop_with_roots(store, Arc::new(Mutex::new(Vec::new())))
    }

    fn make_loop_with_roots(
        store: Arc<Mutex<dyn ScanDiffStore>>,
        skip_roots: Arc<Mutex<Vec<String>>>,
    ) -> (ScanLoop, Arc<Mutex<Vec<ScanEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let loop_body = ScanLoop {
            store,
            classifier: Arc::new(ExtensionClassifier::new()),
            params: test_params(),
            sink: Arc::new(CollectSink(events.clone())),
            shared: Arc::new(Shared {
                queue: Mutex::new(VecDeque::new()),
                status: Mutex::new(ScanStatus::default()),
                cancel: AtomicBool::new(false),
                wake: Condvar::new(),
            }),
            enumerator: Arc::new(WalkDirEnumerator::new(
                crate::core::ignore::IgnoreMatcher::new(),
                skip_roots,
            )),
        };
        (loop_body, events)
    }

    fn record(path: &str, state: &str) -> FileRecord {
        let mut r = FileRecord::new(path, 1, 1, state);
        r.modified = 1;
        r
    }

    #[test]
    fn scan_indexes_files_with_labels_and_ignores_transients() {
        let dir = temp_dir("index");
        fs::write(dir.join("notes.pdf"), b"x").unwrap();
        fs::write(dir.join("main.rs"), b"x").unwrap();
        fs::write(dir.join("song.mp3"), b"x").unwrap();
        fs::write(dir.join("movie.crdownload"), b"x").unwrap();
        fs::write(dir.join("desktop.ini"), b"x").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/inner.txt"), b"x").unwrap();

        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let (loop_body, events) = make_loop(store.clone());
        loop_body.scan_dir(&dir.to_string_lossy());

        assert_eq!(store.lock().unwrap().count().unwrap(), 4);
        let pdf = store
            .lock()
            .unwrap()
            .get_by_path(&format!(
                "{}/notes.pdf",
                dir.to_string_lossy().replace('\\', "/")
            ))
            .unwrap()
            .unwrap();
        assert_eq!(pdf.labels, "document");
        let rs = store
            .lock()
            .unwrap()
            .get_by_path(&format!(
                "{}/main.rs",
                dir.to_string_lossy().replace('\\', "/")
            ))
            .unwrap()
            .unwrap();
        assert_eq!(rs.labels, "code");
        assert!(store
            .lock()
            .unwrap()
            .get_by_path(&format!(
                "{}/movie.crdownload",
                dir.to_string_lossy().replace('\\', "/")
            ))
            .unwrap()
            .is_none());

        let events = events.lock().unwrap();
        let finished = events
            .iter()
            .find_map(|e| match e {
                ScanEvent::Finished { summary } => Some(summary),
                _ => None,
            })
            .expect("应有 Finished 事件");
        assert_eq!(finished.discovered, 4);
        assert_eq!(finished.added, 4);
        assert_eq!(finished.ignored, 2);
        assert!(!finished.cancelled);
        // 进度事件应产生（interval=5，discovered=4 < 5，可能没有；不强制）
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scan_marks_missing_and_resurrects_deleted() {
        let dir = temp_dir("missing");
        fs::write(dir.join("keep.txt"), b"x").unwrap();
        let dir_n = dir.to_string_lossy().replace('\\', "/");

        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        // 快照预置：keep（存在）与 gone（不存在）均为 indexed
        store
            .lock()
            .unwrap()
            .upsert(&record(&format!("{dir_n}/keep.txt"), "indexed"))
            .unwrap();
        store
            .lock()
            .unwrap()
            .upsert(&record(&format!("{dir_n}/gone.txt"), "indexed"))
            .unwrap();
        // 复活场景：dead.txt 标记 deleted 但文件实际存在
        store
            .lock()
            .unwrap()
            .upsert(&record(&format!("{dir_n}/dead.txt"), "deleted"))
            .unwrap();
        fs::write(dir.join("dead.txt"), b"x").unwrap();

        let (loop_body, _events) = make_loop(store.clone());
        loop_body.scan_dir(&dir_n);

        assert_eq!(store.lock().unwrap().count().unwrap(), 2);
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&format!("{dir_n}/keep.txt"))
                .unwrap()
                .unwrap()
                .state,
            "indexed"
        );
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&format!("{dir_n}/gone.txt"))
                .unwrap()
                .unwrap()
                .state,
            "deleted"
        );
        // 复活：deleted 记录被扫描 upsert 覆盖回 indexed
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&format!("{dir_n}/dead.txt"))
                .unwrap()
                .unwrap()
                .state,
            "indexed"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn storm_guard_skips_diff_when_most_files_disappear() {
        let dir = temp_dir("storm");
        fs::write(dir.join("only.txt"), b"x").unwrap();
        let dir_n = dir.to_string_lossy().replace('\\', "/");

        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        // 快照预置 600 条（目录中均不存在）→ 候选 600 > guard=max(150, 2)
        let mut records = Vec::new();
        for i in 0..600 {
            records.push(record(&format!("{dir_n}/gone_{i}.txt"), "indexed"));
        }
        store.lock().unwrap().upsert_many(&records).unwrap();

        let (loop_body, events) = make_loop(store.clone());
        loop_body.scan_dir(&dir_n);

        // 风暴保护：600 条应全部保持 indexed（未被误标）
        assert_eq!(store.lock().unwrap().count().unwrap(), 601);
        let events = events.lock().unwrap();
        let finished = events
            .iter()
            .find_map(|e| match e {
                ScanEvent::Finished { summary } => Some(summary),
                _ => None,
            })
            .expect("应有 Finished 事件");
        assert_eq!(finished.missing_deleted, 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_dir_emits_failed() {
        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let (loop_body, events) = make_loop(store);
        loop_body.scan_dir("C:/definitely/not/exists/xyz");
        let events = events.lock().unwrap();
        assert!(matches!(events.first(), Some(ScanEvent::Failed { .. })));
    }

    #[test]
    fn pre_cancelled_scan_keeps_flushed_batches_and_skips_diff() {
        let dir = temp_dir("cancel");
        for i in 0..25 {
            fs::write(dir.join(format!("f{i}.txt")), b"x").unwrap();
        }
        let dir_n = dir.to_string_lossy().replace('\\', "/");

        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        // 预置 3 条 indexed（目录中不存在）→ 若执行差集会被标 deleted
        store
            .lock()
            .unwrap()
            .upsert_many(&[
                record(&format!("{dir_n}/gone1.txt"), "indexed"),
                record(&format!("{dir_n}/gone2.txt"), "indexed"),
                record(&format!("{dir_n}/gone3.txt"), "indexed"),
            ])
            .unwrap();

        let (loop_body, events) = make_loop(store.clone());
        loop_body.shared.cancel.store(true, Ordering::SeqCst);
        loop_body.scan_dir(&dir_n);

        let events = events.lock().unwrap();
        assert!(matches!(events.first(), Some(ScanEvent::Cancelled { .. })));
        // 取消后：新文件未入库、预置记录保持 indexed（差集被跳过）
        assert_eq!(store.lock().unwrap().count().unwrap(), 3);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn system_noise_directory_is_skipped() {
        let dir = temp_dir("noise_dir");
        fs::create_dir_all(dir.join("$RECYCLE.BIN")).unwrap();
        fs::write(dir.join("$RECYCLE.BIN/trash.txt"), b"x").unwrap();
        fs::write(dir.join("normal.txt"), b"x").unwrap();
        let dir_n = dir.to_string_lossy().replace('\\', "/");

        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let (loop_body, _events) = make_loop(store.clone());
        loop_body.scan_dir(&dir_n);

        assert_eq!(store.lock().unwrap().count().unwrap(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn skip_roots_exclude_subtree_from_scan() {
        let dir = temp_dir("skip");
        fs::create_dir_all(dir.join("proj/src")).unwrap();
        fs::write(dir.join("proj/src/main.rs"), b"x").unwrap();
        fs::write(dir.join("note.md"), b"x").unwrap();
        let dir_n = dir.to_string_lossy().replace('\\', "/");
        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let roots = Arc::new(Mutex::new(vec![format!("{dir_n}/proj")]));
        let (loop_body, _events) = make_loop_with_roots(store.clone(), roots);
        loop_body.scan_dir(&dir_n);
        assert_eq!(store.lock().unwrap().count().unwrap(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn symlink_is_not_followed_when_creation_supported() {
        #[cfg(windows)]
        {
            let dir = temp_dir("symlink");
            fs::create_dir_all(dir.join("real")).unwrap();
            fs::write(dir.join("real/target.txt"), b"x").unwrap();
            let link = dir.join("link");
            if std::os::windows::fs::symlink_dir(dir.join("real"), &link).is_err() {
                // 无权限创建符号链接：条件跳过
                fs::remove_dir_all(&dir).unwrap();
                return;
            }
            let dir_n = dir.to_string_lossy().replace('\\', "/");
            let store: Arc<Mutex<dyn ScanDiffStore>> =
                Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
            let (loop_body, _events) = make_loop(store.clone());
            loop_body.scan_dir(&dir_n);
            // 不跟随链接：real/target.txt 会入（链接在同一父目录内），link 子树不重复
            let paths = store.lock().unwrap().paths_with_prefix(&dir_n).unwrap();
            assert_eq!(paths.len(), 1);
            fs::remove_dir_all(&dir).unwrap();
        }
        #[cfg(not(windows))]
        {
            let _ = 0;
        }
    }

    #[test]
    fn scan_service_queue_and_cancel() {
        let dir = temp_dir("service");
        fs::write(dir.join("a.txt"), b"x").unwrap();
        let store: Arc<Mutex<dyn ScanDiffStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut service = ScanService::new(
            store.clone(),
            Arc::new(ExtensionClassifier::new()),
            IgnoreMatcher::new(),
            test_params(),
            Arc::new(CollectSink(events.clone())),
        );
        service.enqueue(dir.to_string_lossy().into_owned());
        service.enqueue(dir.to_string_lossy().into_owned()); // 去重
        assert_eq!(service.status().queued, 1);
        service.start();
        // 轮询等待扫描完成
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            let done = events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, ScanEvent::Finished { .. }));
            if done {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(store.lock().unwrap().count().unwrap(), 1);
        service.remove_dir(&dir.to_string_lossy());
        service.cancel();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn real_scenario_scan_study_labels_archive_undo_query() {
        use crate::core::classify::{Classifier, ClassifierChain};
        use crate::core::query::FileQuery;
        use crate::core::study::seed_study_data;
        use crate::core::study_classify::{reapply_labels, StudyClassifier};
        use crate::infra::archive_engine::{archive_files, undo_file_batch};
        use std::path::Path;

        // 真实临时目录：两门课程文件 + 普通音频，模拟“扫描入库 → 课程标签 → 归档 → 撤销 → 查询”全链路
        let dir = temp_dir("real_scenario");
        fs::create_dir_all(dir.join("课程")).unwrap();
        fs::write(dir.join("课程").join("高等数学-第1章.pdf"), b"x").unwrap();
        fs::write(dir.join("课程").join("高等数学-作业3.docx"), b"x").unwrap();
        fs::write(dir.join("music.mp3"), b"x").unwrap();
        fs::write(dir.join("Cargo.toml"), b"x").unwrap();

        let sqlite = Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let store: Arc<Mutex<dyn ScanDiffStore>> = sqlite.clone();
        let index_store: Arc<Mutex<dyn IndexStore>> = sqlite;
        let (loop_body, _events) = make_loop(store.clone());
        loop_body.scan_dir(&dir.to_string_lossy());
        assert_eq!(store.lock().unwrap().count().unwrap(), 4);

        // 课程标签重分类：只有课程文件获得 course-c-demo-1
        let mut study = StudyClassifier::new();
        study.refresh(&seed_study_data());
        let mut chain = ClassifierChain::new(vec![
            Box::new(ExtensionClassifier::new()) as Box<dyn Classifier>
        ]);
        chain.push(Box::new(study));
        let changed = reapply_labels(&mut *index_store.lock().unwrap(), &chain).unwrap();
        assert_eq!(changed, 2);

        let course_page = |index_store: &Arc<Mutex<dyn IndexStore>>| {
            index_store
                .lock()
                .unwrap()
                .query(&FileQuery {
                    labels: vec!["course-c-demo-1".into()],
                    limit: 10,
                    ..Default::default()
                })
                .unwrap()
        };
        assert_eq!(course_page(&index_store).total, 2);

        // 归档课程 PDF：源文件消失、按课程标签仍能查到归档记录
        let pdf_path = format!(
            "{}/课程/高等数学-第1章.pdf",
            dir.to_string_lossy().replace('\\', "/")
        );
        let archive_root = temp_dir("real_scenario_archive");
        let outcome = archive_files(
            &index_store,
            &archive_root.to_string_lossy(),
            std::slice::from_ref(&pdf_path),
            42,
        )
        .unwrap();
        assert_eq!(outcome.archived, 1);
        assert!(!Path::new(&pdf_path).exists());
        assert!(index_store
            .lock()
            .unwrap()
            .get_by_path(&pdf_path)
            .unwrap()
            .is_none());
        // 归档记录仍带课程标签：查询仍命中，但原路径已不存在
        assert_eq!(course_page(&index_store).total, 2);

        // 撤销恢复：文件回原位、课程标签查询恢复两条
        let undo = undo_file_batch(&index_store, 42).unwrap();
        assert_eq!(undo.archived, 1);
        assert!(Path::new(&pdf_path).exists());
        let restored = index_store
            .lock()
            .unwrap()
            .get_by_path(&pdf_path)
            .unwrap()
            .unwrap();
        assert_eq!(restored.state, "indexed");
        assert_eq!(course_page(&index_store).total, 2);

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&archive_root);
    }
}
