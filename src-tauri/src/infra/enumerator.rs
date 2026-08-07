//! 目录枚举默认实现：基于 walkdir，保持旧扫描的忽略规则、跳过集与符号链接语义。
use crate::core::ignore::IgnoreMatcher;
use crate::core::path::{normalize_path, under_any};
use crate::core::scan::{EnumerateStats, FileEntry, FileEnumerator};
use crate::infra::time::now_millis;
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// walkdir 枚举器：`skip_roots` 与 `ScanService` 共享同一份运行时跳过集。
pub struct WalkDirEnumerator {
    matcher: IgnoreMatcher,
    skip_roots: Arc<Mutex<Vec<String>>>,
}

impl WalkDirEnumerator {
    pub fn new(matcher: IgnoreMatcher, skip_roots: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            matcher,
            skip_roots,
        }
    }
}

impl FileEnumerator for WalkDirEnumerator {
    fn enumerate(
        &self,
        root: &str,
        on_file: &mut dyn FnMut(FileEntry) -> bool,
    ) -> Result<EnumerateStats, String> {
        let mut stats = EnumerateStats::default();
        let walker = WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                if !entry.file_type().is_dir() {
                    return true;
                }
                let name = entry.file_name().to_string_lossy();
                if self.matcher.is_ignored(&name) {
                    return false;
                }
                let path = normalize_path(&entry.path().to_string_lossy());
                let skipped = self
                    .skip_roots
                    .lock()
                    .map(|roots| under_any(&path, &roots))
                    .unwrap_or(false);
                !skipped
            });

        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    stats.errors += 1;
                    log::warn!("scan: 遍历错误 {}: {e}", root);
                    continue;
                }
            };
            if entry.file_type().is_dir() {
                continue;
            }
            // 符号链接/junction 一律不索引（防循环与越界）
            if entry.file_type().is_symlink() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if self.matcher.is_ignored(&file_name) {
                stats.ignored += 1;
                continue;
            }
            stats.discovered += 1;
            let metadata = match std::fs::metadata(entry.path()) {
                Ok(m) => m,
                Err(e) => {
                    stats.errors += 1;
                    log::debug!("scan: metadata 失败 {}: {e}", entry.path().display());
                    continue;
                }
            };
            let path = normalize_path(&entry.path().to_string_lossy());
            let now_ms = now_millis();
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(now_ms);
            let keep_going = on_file(FileEntry {
                path,
                size: metadata.len() as i64,
                modified_ms,
                is_dir: false,
                is_symlink: false,
            });
            if !keep_going {
                break;
            }
        }
        Ok(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_enumerator_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn collect(enumerator: &dyn FileEnumerator, root: &str) -> (Vec<FileEntry>, EnumerateStats) {
        let mut entries = Vec::new();
        let stats = enumerator
            .enumerate(root, &mut |entry| {
                entries.push(entry);
                true
            })
            .unwrap();
        (entries, stats)
    }

    #[test]
    fn emits_files_with_metadata_and_applies_ignore_rules() {
        let dir = temp_dir("emit");
        fs::write(dir.join("a.txt"), b"hello").unwrap();
        fs::write(dir.join("b.pdf"), b"pdf").unwrap();
        fs::write(dir.join("tmp.crdownload"), b"x").unwrap();
        let matcher = IgnoreMatcher::new();
        let enumerator = WalkDirEnumerator::new(matcher, Arc::new(Mutex::new(Vec::new())));
        let root = normalize_path(&dir.to_string_lossy());
        let (entries, stats) = collect(&enumerator, &root);
        let names: Vec<String> = entries
            .iter()
            .map(|e| e.path.rsplit('/').next().unwrap().to_string())
            .collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(sorted, vec!["a.txt".to_string(), "b.pdf".to_string()]);
        assert_eq!(stats.discovered, 2);
        assert_eq!(stats.ignored, 1);
        let pdf = entries.iter().find(|e| e.path.ends_with("b.pdf")).unwrap();
        assert_eq!(pdf.size, 3);
        assert!(pdf.modified_ms > 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn skips_roots_and_stops_on_false_callback() {
        let dir = temp_dir("skip");
        fs::create_dir_all(dir.join("proj")).unwrap();
        fs::write(dir.join("proj").join("main.rs"), b"x").unwrap();
        fs::write(dir.join("top.txt"), b"x").unwrap();
        let skip = Arc::new(Mutex::new(vec![normalize_path(
            &dir.join("proj").to_string_lossy(),
        )]));
        let enumerator = WalkDirEnumerator::new(IgnoreMatcher::new(), skip);
        let root = normalize_path(&dir.to_string_lossy());
        let (entries, _) = collect(&enumerator, &root);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].path.ends_with("top.txt"));

        let mut count = 0;
        let stats = enumerator
            .enumerate(&root, &mut |_| {
                count += 1;
                count < 1
            })
            .unwrap();
        assert_eq!(stats.discovered, 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
