//! 自动归档后台队列：新稳定文件入队，worker 单线程串行归档。
use crate::core::archive::AUTO_QUEUE_CAPACITY;
use crate::core::index::IndexStore;
use crate::infra::archive_engine::{archive_files, now_millis};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

struct ArchiveInner {
    store: Arc<Mutex<dyn IndexStore>>,
    root: Mutex<String>,
    queue: Mutex<VecDeque<String>>,
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
    }

    pub fn start(&mut self) {
        if self.handle.lock().unwrap().is_some() {
            return;
        }
        let inner = self.inner.clone();
        let handle = std::thread::Builder::new()
            .name("rootup-archiver".into())
            .spawn(move || loop {
                if !inner.running.load(Ordering::SeqCst) {
                    break;
                }
                let path = inner.queue.lock().unwrap().pop_front();
                let Some(path) = path else {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                };
                if !inner.enabled.load(Ordering::SeqCst) {
                    continue;
                }
                let root = inner.root.lock().unwrap().clone();
                if root.is_empty() {
                    continue;
                }
                let batch_id = now_millis();
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
        self.inner.running.store(true, Ordering::SeqCst);
        *self.handle.lock().unwrap() = Some(handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::index::{FileRecord, IndexStore};
    use crate::core::path::normalize_path;
    use crate::infra::index_store::SqliteIndexStore;
    use std::fs;
    use std::path::PathBuf;
    use std::time::Duration;

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
}
