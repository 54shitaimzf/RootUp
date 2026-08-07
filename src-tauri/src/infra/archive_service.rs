//! 自动归档后台队列：新稳定文件入队，worker 单线程串行归档。
use crate::core::archive::AUTO_QUEUE_CAPACITY;
use crate::core::index::IndexStore;
use crate::infra::archive_engine::{archive_files, next_batch_id};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

struct ArchiveInner {
    store: Arc<Mutex<dyn IndexStore>>,
    root: Mutex<String>,
    queue: Mutex<VecDeque<String>>,
    wake: Condvar,
    enabled: AtomicBool,
    running: AtomicBool,
}

/// 自动归档服务：`update` 同步开关与根目录，`enqueue` 仅在上方开关开启时被调用。
pub struct ArchiveService {
    inner: Arc<ArchiveInner>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl ArchiveService {
    pub fn new(store: Arc<Mutex<dyn IndexStore>>, root: String, enabled: bool) -> Self {
        Self {
            inner: Arc::new(ArchiveInner {
                store,
                root: Mutex::new(root),
                queue: Mutex::new(VecDeque::new()),
                wake: Condvar::new(),
                enabled: AtomicBool::new(enabled),
                running: AtomicBool::new(false),
            }),
            handle: Mutex::new(None),
        }
    }

    pub fn update(&self, root: String, enabled: bool) {
        if let Ok(mut guard) = self.inner.root.lock() {
            *guard = root;
        }
        self.inner.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn enqueue(&self, path: String) {
        if !self.inner.enabled.load(Ordering::SeqCst) {
            return;
        }
        let mut queue = match self.inner.queue.lock() {
            Ok(q) => q,
            Err(_) => return,
        };
        if queue.len() >= AUTO_QUEUE_CAPACITY {
            log::warn!("archive: 自动归档队列已满，跳过 {path}");
            return;
        }
        queue.push_back(path);
        drop(queue);
        self.inner.wake.notify_all();
    }

    pub fn start(&mut self) {
        if self.handle.lock().unwrap().is_some() {
            return;
        }
        self.inner.running.store(true, Ordering::SeqCst);
        let inner = self.inner.clone();
        let handle = std::thread::Builder::new()
            .name("rootup-archiver".into())
            .spawn(move || loop {
                let path = {
                    let mut queue = inner.queue.lock().unwrap();
                    loop {
                        if !inner.running.load(Ordering::SeqCst) {
                            break None;
                        }
                        if let Some(p) = queue.pop_front() {
                            break Some(p);
                        }
                        let (guard, _) = inner
                            .wake
                            .wait_timeout(queue, Duration::from_millis(1000))
                            .unwrap();
                        queue = guard;
                    }
                };
                let Some(path) = path else { break };
                if !inner.enabled.load(Ordering::SeqCst) {
                    continue;
                }
                let root = inner.root.lock().unwrap().clone();
                if root.is_empty() {
                    continue;
                }
                let batch_id = next_batch_id();
                match archive_files(&inner.store, &root, std::slice::from_ref(&path), batch_id) {
                    Ok(outcome) => {
                        log::info!(
                            "archive: 自动 batch={} archived={} failed={}",
                            outcome.batch_id.unwrap_or_default(),
                            outcome.archived,
                            outcome.failed.len()
                        );
                    }
                    Err(e) => log::warn!("archive: 自动归档失败 path={path} err={e}"),
                }
            })
            .expect("自动归档线程创建失败");
        *self.handle.lock().unwrap() = Some(handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::archive::category_dir;
    use crate::core::classify::ExtensionClassifier;
    use crate::core::events::StabilityParams;
    use crate::core::ignore::IgnoreMatcher;
    use crate::core::index::{FileRecord, IndexStore};
    use crate::core::path::normalize_path;
    use crate::infra::index_store::SqliteIndexStore;
    use crate::infra::watcher::WatchService;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rootup_archive_service_{}_{}",
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

    #[test]
    fn enqueue_gated_by_enabled_flag() {
        let service = ArchiveService::new(store(), "C:/Archive".into(), false);
        service.enqueue("C:/a.pdf".into());
        assert_eq!(service.inner.queue.lock().unwrap().len(), 0);
        service.update("C:/Archive".into(), true);
        service.enqueue("C:/a.pdf".into());
        assert_eq!(service.inner.queue.lock().unwrap().len(), 1);
    }

    #[test]
    fn worker_archives_enqueued_file() {
        let dir = temp_dir("worker");
        let downloads = dir.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let src = downloads.join("note.md");
        fs::write(&src, "x").unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        {
            let mut guard = store.lock().unwrap();
            let mut r = FileRecord::new(&normalize_path(&src.to_string_lossy()), 10, 1, "indexed");
            r.labels = "document".into();
            guard.upsert(&r).unwrap();
        }

        let mut service = ArchiveService::new(store, root.clone(), true);
        service.start();
        assert!(
            service.inner.running.load(Ordering::SeqCst),
            "start 返回后 running 必须为 true（线程不得先观察到 false 而退出）"
        );
        service.enqueue(normalize_path(&src.to_string_lossy()));

        let mut moved = false;
        for _ in 0..40 {
            if !src.exists() {
                moved = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(moved, "worker 未在预期时间内归档文件");
        assert!(PathBuf::from(&root).join("document/note.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 完整链路：真实 notify 监听新文件 → 稳定入库 → 自动归档 → 索引/日志。
    #[test]
    fn watcher_to_auto_archive_full_flow() {
        let dir = temp_dir("flow");
        let watched = dir.join("Downloads");
        fs::create_dir_all(&watched).unwrap();
        let root = dir.join("Archive").to_string_lossy().to_string();
        let store = store();
        let archive = Arc::new(Mutex::new(ArchiveService::new(
            store.clone(),
            root.clone(),
            true,
        )));
        archive.lock().unwrap().start();
        let archive_cb = archive.clone();
        let mut watcher = WatchService::new(
            store.clone(),
            Arc::new(ExtensionClassifier::new()),
            IgnoreMatcher::new(),
            StabilityParams {
                first_sample_delay: Duration::from_millis(50),
                sample_gap: Duration::from_millis(50),
                force_timeout: Duration::from_secs(5),
                debounce_window: Duration::from_millis(100),
            },
            move |records| {
                if let Ok(service) = archive_cb.lock() {
                    for record in records {
                        if record.state == "indexed" && category_dir(&record.labels) != "other" {
                            service.enqueue(record.path);
                        }
                    }
                }
            },
        )
        .unwrap();
        watcher.update_skip_roots(vec![root.clone()]);
        watcher.add_dir(&watched).unwrap();
        watcher.start();
        // 等待 notify 注册完成，避免首事件丢失
        std::thread::sleep(Duration::from_millis(300));

        let src = watched.join("report.pdf");
        fs::write(&src, "x").unwrap();
        let dest = PathBuf::from(&root).join("document/report.pdf");

        let deadline = Instant::now() + Duration::from_secs(20);
        let mut moved = false;
        while Instant::now() < deadline {
            if dest.exists() {
                moved = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        watcher.stop();
        assert!(moved, "自动归档未在时限内完成");
        let dest_str = normalize_path(&dest.to_string_lossy());
        let rec = store
            .lock()
            .unwrap()
            .get_by_path(&dest_str)
            .unwrap()
            .unwrap();
        assert_eq!(rec.state, "archived");
        assert_eq!(
            store
                .lock()
                .unwrap()
                .list_archive_batches(10)
                .unwrap()
                .len(),
            1
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
