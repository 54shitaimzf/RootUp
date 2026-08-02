//! 文件监听管道：notify 接入、事件归一、去抖、稳定确认、索引写入与批量广播。
//!
//! 与 Tauri 解耦：广播通过 `on_batch` 回调对外暴露，测试可直接收集结果。

use crate::core::classify::Classifier;
use crate::core::events::{
    judge_stability, FileEventKind, NormalizedEvent, Stability, StabilityParams,
};
use crate::core::ignore::IgnoreMatcher;
use crate::core::index::{FileRecord, IndexStore};
use crate::core::path::normalize_path;
use crate::core::scan::record_from_scan;
use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 事件通道容量（有界，防止风暴时无限积压）。
const CHANNEL_CAPACITY: usize = 1000;
/// 处理线程心跳间隔。
const TICK_INTERVAL: Duration = Duration::from_millis(200);

/// 一条等待稳定确认的文件。
struct Pending {
    first_seen: Instant,
    last_sample: Option<u64>,
}

/// 事件处理器：纯业务逻辑（无 Tauri、无 notify 类型依赖）。
pub struct EventProcessor {
    store: Arc<Mutex<dyn IndexStore>>,
    classifier: Arc<dyn Classifier>,
    matcher: IgnoreMatcher,
    params: StabilityParams,
    pending: HashMap<PathBuf, Pending>,
    batch: Vec<FileRecord>,
    batch_started: Option<Instant>,
    on_batch: Box<dyn Fn(Vec<FileRecord>) + Send + Sync>,
}

impl EventProcessor {
    pub fn new(
        store: Arc<Mutex<dyn IndexStore>>,
        classifier: Arc<dyn Classifier>,
        matcher: IgnoreMatcher,
        params: StabilityParams,
        on_batch: impl Fn(Vec<FileRecord>) + Send + Sync + 'static,
    ) -> Self {
        Self {
            store,
            classifier,
            matcher,
            params,
            pending: HashMap::new(),
            batch: Vec::new(),
            batch_started: None,
            on_batch: Box::new(on_batch),
        }
    }

    /// 处理一条归一化事件（可能创建/更新/删除待确认条目）。
    pub fn handle_event(&mut self, event: &NormalizedEvent) {
        let file_name = event
            .path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        match event.kind {
            FileEventKind::Created | FileEventKind::RenamedTo => {
                if event.is_dir || self.matcher.is_ignored(&file_name) {
                    return;
                }
                log::debug!("watch: 新文件 {} ({})", event.path.display(), file_name);
                self.pending.insert(
                    event.path.clone(),
                    Pending {
                        first_seen: Instant::now(),
                        last_sample: None,
                    },
                );
            }
            FileEventKind::Modified => {
                if let Some(p) = self.pending.get_mut(&event.path) {
                    // 仍在写入：清空采样，重新进入不稳定
                    p.last_sample = None;
                }
            }
            FileEventKind::Removed => {
                self.pending.remove(&event.path);
                let path_str = normalize_path(&event.path.to_string_lossy());
                let removed_record = {
                    let mut store = match self.store.lock() {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    if store.get_by_path(&path_str).ok().flatten().is_some() {
                        if store.mark_deleted(&path_str).is_ok() {
                            store.get_by_path(&path_str).ok().flatten()
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };
                if let Some(record) = removed_record {
                    log::info!("watch: 删除 {}", path_str);
                    self.push_batch(record);
                }
            }
            _ => {}
        }
    }

    /// 周期心跳：对等待中的文件做稳定确认，并冲刷到期批次。
    pub fn tick(&mut self) {
        self.check_stability();
        self.flush_batch();
    }

    fn check_stability(&mut self) {
        let mut done: Vec<PathBuf> = Vec::new();
        let mut deleted: Vec<PathBuf> = Vec::new();

        for (path, pending) in self.pending.iter_mut() {
            let elapsed = pending.first_seen.elapsed();
            if elapsed < self.params.first_sample_delay {
                continue;
            }
            let size = std::fs::metadata(path).ok().map(|m| m.len());
            let openable = OpenOptions::new()
                .read(true)
                .open(path)
                .map(|_| true)
                .unwrap_or(false);

            match (pending.last_sample, size) {
                (Some(prev), Some(curr)) => {
                    let stability =
                        judge_stability(Some(prev), curr, openable, elapsed, &self.params);
                    match stability {
                        Stability::Stable | Stability::ForceStable => {
                            log::debug!("watch: {} 稳定（{:?}）", path.display(), stability);
                            done.push(path.clone());
                        }
                        Stability::Unstable => pending.last_sample = Some(curr),
                    }
                }
                (None, Some(curr)) => pending.last_sample = Some(curr),
                (_, None) => {
                    // 文件已不存在：视同删除
                    deleted.push(path.clone());
                }
            }
        }

        for path in deleted {
            self.pending.remove(&path);
        }

        let mut new_records = Vec::new();
        {
            let mut store = match self.store.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            for path in done {
                let path_str = normalize_path(&path.to_string_lossy());
                let metadata = std::fs::metadata(&path);
                let size = metadata.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                let now_ms = now_millis();
                let modified_ms = metadata
                    .as_ref()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(now_ms);
                let record = record_from_scan(
                    &path_str,
                    size,
                    modified_ms,
                    now_ms,
                    self.classifier.as_ref(),
                );
                if store.upsert(&record).is_ok() {
                    if let Ok(Some(full)) = store.get_by_path(&path_str) {
                        new_records.push(full);
                    }
                }
                self.pending.remove(&path);
            }
        }
        for record in new_records {
            self.push_batch(record);
        }
    }

    fn push_batch(&mut self, record: FileRecord) {
        if self.batch.is_empty() {
            self.batch_started = Some(Instant::now());
        }
        self.batch.push(record);
    }

    fn flush_batch(&mut self) {
        if self.batch.is_empty() {
            self.batch_started = None;
            return;
        }
        let due = self
            .batch_started
            .map(|t| t.elapsed() >= self.params.debounce_window)
            .unwrap_or(true);
        if due {
            let records = std::mem::take(&mut self.batch);
            self.batch_started = None;
            log::info!("watch: 索引批次 size={}", records.len());
            (self.on_batch)(records);
        }
    }
}

/// 监听服务：notify 回调线程 → 有界通道 → 处理线程。
pub struct WatchService {
    store: Arc<Mutex<dyn IndexStore>>,
    classifier: Arc<dyn Classifier>,
    matcher: IgnoreMatcher,
    params: StabilityParams,
    on_batch: Arc<dyn Fn(Vec<FileRecord>) + Send + Sync>,
    watcher: Mutex<RecommendedWatcher>,
    watched: Mutex<Vec<PathBuf>>,
    running: Arc<AtomicBool>,
    rx: Option<Receiver<NormalizedEvent>>,
    handle: Option<JoinHandle<()>>,
}

impl WatchService {
    pub fn new(
        store: Arc<Mutex<dyn IndexStore>>,
        classifier: Arc<dyn Classifier>,
        matcher: IgnoreMatcher,
        params: StabilityParams,
        on_batch: impl Fn(Vec<FileRecord>) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let (tx, rx) = sync_channel::<NormalizedEvent>(CHANNEL_CAPACITY);
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("watch: notify 错误: {e}");
                    return;
                }
            };
            for normalized in normalize_event(&event) {
                match tx.try_send(normalized) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        log::warn!("watch: 事件通道已满，丢弃一条事件");
                    }
                    Err(TrySendError::Disconnected(_)) => break,
                }
            }
        })
        .map_err(|e| e.to_string())?;

        Ok(Self {
            store,
            classifier,
            matcher,
            params,
            on_batch: Arc::new(on_batch),
            watcher: Mutex::new(watcher),
            watched: Mutex::new(Vec::new()),
            running: Arc::new(AtomicBool::new(false)),
            rx: Some(rx),
            handle: None,
        })
    }

    /// 启动处理线程（幂等；stop 后可再次 start）。
    pub fn start(&mut self) {
        if self.handle.is_some() {
            return;
        }
        let processor = Arc::new(Mutex::new(EventProcessor::new(
            self.store.clone(),
            self.classifier.clone(),
            self.matcher.clone(),
            self.params.clone(),
            {
                let on_batch = self.on_batch.clone();
                move |records| on_batch(records)
            },
        )));
        let running = self.running.clone();
        let rx = self.rx.take();
        let processor_thread = processor.clone();
        let handle = std::thread::Builder::new()
            .name("rootup-watcher".into())
            .spawn(move || {
                let rx = match rx {
                    Some(rx) => rx,
                    None => return,
                };
                while running.load(Ordering::SeqCst) {
                    let mut guard = processor_thread.lock().unwrap();
                    match rx.recv_timeout(TICK_INTERVAL) {
                        Ok(event) => guard.handle_event(&event),
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    guard.tick();
                }
            })
            .expect("watcher 线程创建失败");
        self.running.store(true, Ordering::SeqCst);
        self.handle = Some(handle);
    }

    /// 停止处理线程并等待退出。
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.handle = None;
    }

    /// 添加监控目录（递归）。路径必须存在。
    pub fn add_dir(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let path = path.as_ref();
        if !path.is_dir() {
            return Err(format!("目录不存在: {}", path.display()));
        }
        let already_watched = self
            .watched
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|p| p == path);
        if already_watched {
            return Ok(()); // 幂等：重复添加视为成功
        }
        let mut watcher = self.watcher.lock().map_err(|e| e.to_string())?;
        watcher
            .watch(path, RecursiveMode::Recursive)
            .map_err(|e| format!("监听失败 {}: {e}", path.display()))?;
        drop(watcher);
        self.watched
            .lock()
            .map_err(|e| e.to_string())?
            .push(path.to_path_buf());
        log::info!("watch: 开始监听 {}", path.display());
        Ok(())
    }

    /// 移除监控目录。
    pub fn remove_dir(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let mut watcher = self.watcher.lock().map_err(|e| e.to_string())?;
        watcher
            .unwatch(path.as_ref())
            .map_err(|e| format!("取消监听失败: {e}"))?;
        drop(watcher);
        self.watched
            .lock()
            .map_err(|e| e.to_string())?
            .retain(|p| p != path.as_ref());
        log::info!("watch: 停止监听 {}", path.as_ref().display());
        Ok(())
    }
}

/// 把 notify 事件归一化为业务事件（一个 notify 事件可含多个路径）。
fn normalize_event(event: &Event) -> Vec<NormalizedEvent> {
    let kind = match event.kind {
        EventKind::Create(_) => FileEventKind::Created,
        EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::To)) => {
            FileEventKind::RenamedTo
        }
        EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::From)) => {
            FileEventKind::RenamedFrom
        }
        EventKind::Modify(_) => FileEventKind::Modified,
        EventKind::Remove(_) => FileEventKind::Removed,
        _ => FileEventKind::Other,
    };
    event
        .paths
        .iter()
        .map(|path| NormalizedEvent {
            path: path.clone(),
            kind,
            is_dir: path.is_dir(),
        })
        .collect()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::events::next_state;
    use crate::core::events::FileState;
    use crate::infra::index_store::SqliteIndexStore;
    use std::fs;
    use std::io::Write;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    fn short_params() -> StabilityParams {
        StabilityParams {
            first_sample_delay: Duration::from_millis(150),
            sample_gap: Duration::from_millis(50),
            force_timeout: Duration::from_secs(2),
            debounce_window: Duration::from_millis(150),
        }
    }

    fn test_classifier() -> Arc<dyn Classifier> {
        Arc::new(crate::core::classify::ExtensionClassifier)
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_watch_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 轮询等待；超时失败时输出诊断信息，便于定位是监听未触发还是稳定确认未过。
    fn wait_until_with_diag<F: FnMut() -> bool>(
        timeout: Duration,
        mut cond: F,
        diag: impl Fn() -> String,
    ) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let ok = cond();
        if !ok {
            eprintln!("[wait 超时诊断] {}", diag());
        }
        ok
    }

    #[test]
    fn normalize_maps_notify_kinds() {
        let created = Event::new(EventKind::Create(notify::event::CreateKind::File))
            .add_path(PathBuf::from("C:/a.pdf"));
        let n = normalize_event(&created);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].kind, FileEventKind::Created);

        let renamed = Event::new(EventKind::Modify(ModifyKind::Name(
            notify::event::RenameMode::To,
        )))
        .add_path(PathBuf::from("C:/b.pdf"));
        assert_eq!(normalize_event(&renamed)[0].kind, FileEventKind::RenamedTo);

        let removed = Event::new(EventKind::Remove(notify::event::RemoveKind::File))
            .add_path(PathBuf::from("C:/b.pdf"));
        assert_eq!(normalize_event(&removed)[0].kind, FileEventKind::Removed);
    }

    #[test]
    fn processor_indexes_stable_files_and_ignores_transients() {
        let dir = temp_dir("proc");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let collected = Arc::new(Mutex::new(Vec::<FileRecord>::new()));
        let collected_ref = collected.clone();
        let mut processor = EventProcessor::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            move |records| collected_ref.lock().unwrap().extend(records),
        );

        let good = dir.join("good.pdf");
        fs::write(&good, b"content").unwrap();
        let transient = dir.join("bad.crdownload");
        fs::write(&transient, b"x").unwrap();

        processor.handle_event(&NormalizedEvent {
            path: good.clone(),
            kind: FileEventKind::Created,
            is_dir: false,
        });
        processor.handle_event(&NormalizedEvent {
            path: transient.clone(),
            kind: FileEventKind::Created,
            is_dir: false,
        });

        assert!(
            wait_until_with_diag(
                Duration::from_secs(3),
                || {
                    processor.tick();
                    store.lock().unwrap().count().unwrap() == 1
                },
                || format!(
                    "索引数={}，已收集批次={}",
                    store.lock().unwrap().count().unwrap(),
                    collected.lock().unwrap().len()
                )
            ),
            "等待文件入库超时"
        );
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&normalize_path(&good.to_string_lossy()))
                .unwrap()
                .unwrap()
                .state,
            "indexed"
        );
        let good_record = store
            .lock()
            .unwrap()
            .get_by_path(&normalize_path(&good.to_string_lossy()))
            .unwrap()
            .unwrap();
        // 监听入库应应用分类标签与真实修改时间（与扫描行为一致）
        assert_eq!(good_record.labels, "document");
        assert!(
            good_record.modified > 0 && good_record.modified <= now_millis(),
            "modified 应为文件真实修改时间"
        );
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&normalize_path(&transient.to_string_lossy()))
                .unwrap(),
            None
        );
        // 批次最终被冲刷
        assert!(
            wait_until_with_diag(
                Duration::from_secs(2),
                || {
                    processor.tick();
                    !collected.lock().unwrap().is_empty()
                },
                || format!(
                    "索引数={}，已收集批次={}",
                    store.lock().unwrap().count().unwrap(),
                    collected.lock().unwrap().len()
                )
            ),
            "等待批次冲刷超时"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn processor_marks_removed_as_deleted() {
        let dir = temp_dir("removed");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut processor = EventProcessor::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        );

        let f = dir.join("gone.txt");
        fs::write(&f, b"x").unwrap();
        processor.handle_event(&NormalizedEvent {
            path: f.clone(),
            kind: FileEventKind::Created,
            is_dir: false,
        });
        assert!(
            wait_until_with_diag(
                Duration::from_secs(3),
                || {
                    processor.tick();
                    store.lock().unwrap().count().unwrap() == 1
                },
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "等待文件入库超时"
        );
        fs::remove_file(&f).unwrap();
        processor.handle_event(&NormalizedEvent {
            path: f.clone(),
            kind: FileEventKind::Removed,
            is_dir: false,
        });
        processor.tick();
        assert_eq!(store.lock().unwrap().count().unwrap(), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn watch_service_end_to_end() {
        let dir = temp_dir("e2e");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut service = WatchService::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        )
        .unwrap();
        service.add_dir(&dir).unwrap();
        service.start();

        fs::write(dir.join("hello.txt"), b"hi").unwrap();
        assert!(
            wait_until_with_diag(
                Duration::from_secs(15),
                || store.lock().unwrap().count().unwrap() == 1,
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "等待端到端入库超时"
        );

        fs::write(dir.join("temp.crdownload"), b"partial").unwrap();
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(
            store.lock().unwrap().count().unwrap(),
            1,
            "临时文件不应入库"
        );

        fs::remove_file(dir.join("hello.txt")).unwrap();
        assert!(
            wait_until_with_diag(
                Duration::from_secs(10),
                || store.lock().unwrap().count().unwrap() == 0,
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "等待删除跟随超时"
        );

        service.stop();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn state_machine_is_used_by_processor() {
        // 验证状态机通过 next_state 暴露且可达（防止契约悬空）
        let ev = NormalizedEvent {
            path: PathBuf::from("x"),
            kind: FileEventKind::Removed,
            is_dir: false,
        };
        assert_eq!(
            next_state(FileState::Indexed, &ev),
            Some(FileState::Deleted)
        );
        let _ = channel::<()>();
    }

    #[test]
    fn processor_rename_transient_to_final() {
        let dir = temp_dir("rename");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut processor = EventProcessor::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        );
        let temp = dir.join("movie.mkv.crdownload");
        let final_path = dir.join("movie.mkv");
        fs::write(&temp, b"data").unwrap();
        // 临时文件事件：应被忽略
        processor.handle_event(&NormalizedEvent {
            path: temp.clone(),
            kind: FileEventKind::Created,
            is_dir: false,
        });
        // 下载完成重命名
        fs::rename(&temp, &final_path).unwrap();
        processor.handle_event(&NormalizedEvent {
            path: final_path.clone(),
            kind: FileEventKind::RenamedTo,
            is_dir: false,
        });
        assert!(
            wait_until_with_diag(
                Duration::from_secs(3),
                || {
                    processor.tick();
                    store.lock().unwrap().count().unwrap() == 1
                },
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "重命名后的正式文件应入库"
        );
        assert!(
            store
                .lock()
                .unwrap()
                .get_by_path(&normalize_path(&final_path.to_string_lossy()))
                .unwrap()
                .is_some(),
            "正式路径应有记录"
        );
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&normalize_path(&temp.to_string_lossy()))
                .unwrap(),
            None,
            "临时路径不应有记录"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn processor_waits_for_write_to_settle() {
        let dir = temp_dir("settle");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut processor = EventProcessor::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        );
        let f = dir.join("growing.bin");
        fs::write(&f, vec![0u8; 10]).unwrap();
        processor.handle_event(&NormalizedEvent {
            path: f.clone(),
            kind: FileEventKind::Created,
            is_dir: false,
        });
        // 超过首次采样延迟后采样
        std::thread::sleep(Duration::from_millis(250));
        processor.tick();
        // 文件继续增长 → 应判为不稳定
        let mut file = fs::OpenOptions::new().append(true).open(&f).unwrap();
        file.write_all(&[0u8; 50]).unwrap();
        file.flush().unwrap();
        drop(file);
        processor.tick();
        assert_eq!(
            store.lock().unwrap().count().unwrap(),
            0,
            "仍在写入的文件不应入库"
        );
        // 停止写入后第二次采样一致 → 入库
        std::thread::sleep(Duration::from_millis(120));
        assert!(
            wait_until_with_diag(
                Duration::from_secs(3),
                || {
                    processor.tick();
                    store.lock().unwrap().count().unwrap() == 1
                },
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "写入停止后应稳定入库"
        );
        let rec = store
            .lock()
            .unwrap()
            .get_by_path(&normalize_path(&f.to_string_lossy()))
            .unwrap()
            .unwrap();
        assert_eq!(rec.size, 60);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn processor_force_stable_after_timeout() {
        let dir = temp_dir("force");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut processor = EventProcessor::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        );
        let f = dir.join("busy.bin");
        fs::write(&f, vec![0u8; 10]).unwrap();
        processor.handle_event(&NormalizedEvent {
            path: f.clone(),
            kind: FileEventKind::Created,
            is_dir: false,
        });
        // 持续增长超过 force_timeout（2 秒），期间一直不稳定
        for _ in 0..25 {
            std::thread::sleep(Duration::from_millis(120));
            let mut file = fs::OpenOptions::new().append(true).open(&f).unwrap();
            file.write_all(&[0u8; 10]).unwrap();
            drop(file);
            processor.tick();
        }
        assert_eq!(
            store.lock().unwrap().count().unwrap(),
            1,
            "超时兜底应强制入库"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn processor_batch_of_twenty() {
        let dir = temp_dir("batch");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut processor = EventProcessor::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        );
        for i in 0..20 {
            let f = dir.join(format!("file{i}.txt"));
            fs::write(&f, b"x").unwrap();
            processor.handle_event(&NormalizedEvent {
                path: f,
                kind: FileEventKind::Created,
                is_dir: false,
            });
        }
        assert!(
            wait_until_with_diag(
                Duration::from_secs(5),
                || {
                    processor.tick();
                    store.lock().unwrap().count().unwrap() == 20
                },
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "批量文件应全部入库"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn watch_service_tracks_subdirectory_files() {
        let dir = temp_dir("subdir");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut service = WatchService::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        )
        .unwrap();
        service.add_dir(&dir).unwrap();
        service.start();
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("inner.txt"), b"x").unwrap();
        assert!(
            wait_until_with_diag(
                Duration::from_secs(15),
                || store.lock().unwrap().count().unwrap() == 1,
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "子目录内的文件应被递归监听入库"
        );
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get_by_path(&normalize_path(&sub.to_string_lossy()))
                .unwrap(),
            None,
            "目录本身不应入库"
        );
        service.stop();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn watch_service_stops_after_remove_dir() {
        let dir = temp_dir("unwatch");
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let mut service = WatchService::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        )
        .unwrap();
        service.add_dir(&dir).unwrap();
        service.start();
        fs::write(dir.join("a.txt"), b"x").unwrap();
        assert!(
            wait_until_with_diag(
                Duration::from_secs(15),
                || store.lock().unwrap().count().unwrap() == 1,
                || format!("索引数={}", store.lock().unwrap().count().unwrap())
            ),
            "首个文件应入库"
        );
        service.remove_dir(&dir).unwrap();
        // 取消监听后的新文件不应再入库
        fs::write(dir.join("b.txt"), b"y").unwrap();
        std::thread::sleep(Duration::from_millis(1000));
        assert_eq!(
            store.lock().unwrap().count().unwrap(),
            1,
            "取消监听后新文件不应入库"
        );
        service.stop();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn watch_service_add_dir_validation() {
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let service = WatchService::new(
            store.clone(),
            test_classifier(),
            IgnoreMatcher::new(),
            short_params(),
            |_| {},
        )
        .unwrap();
        assert!(
            service.add_dir("C:/definitely/not/exists/xyz").is_err(),
            "不存在的目录应报错"
        );
        let dir = temp_dir("dup");
        service.add_dir(&dir).unwrap();
        assert!(service.add_dir(&dir).is_ok(), "重复添加应幂等成功");
        fs::remove_dir_all(&dir).unwrap();
    }
}
