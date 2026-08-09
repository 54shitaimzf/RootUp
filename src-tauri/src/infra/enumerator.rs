//! 目录枚举默认实现：基于 walkdir，保持旧扫描的忽略规则、跳过集与符号链接语义。
use crate::core::ignore::IgnoreMatcher;
use crate::core::path::{normalize_path, under_any};
use crate::core::scan::{EnumerateStats, FileEntry, FileEnumerator};
use crate::infra::time::now_millis;
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[cfg(all(windows, any(test, feature = "bench")))]
use windows::core::PCWSTR;
#[cfg(all(windows, any(test, feature = "bench")))]
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_FILES, FILETIME, HANDLE};
#[cfg(all(windows, any(test, feature = "bench")))]
use windows::Win32::Storage::FileSystem::{
    FindClose, FindFirstFileW, FindNextFileW, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, WIN32_FIND_DATAW,
};

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
        // 跳过集在枚举开始时快照一次，避免每个目录重复加锁与克隆；
        // 时间戳也只取一次，作为 metadata 失败时的 fallback。
        let skip_roots = self
            .skip_roots
            .lock()
            .map(|roots| roots.clone())
            .unwrap_or_default();
        let now_ms = now_millis();
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
                !under_any(&path, &skip_roots)
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

/// Windows 原生枚举器（实验性，0.8.6 验证项 B）：`FindFirstFileW/FindNextFileW`
/// 直取 `WIN32_FIND_DATA` 的大小 / 时间 / 属性，省掉 walkdir 每文件一次
/// `std::fs::metadata` 系统调用。语义与 `WalkDirEnumerator` 对齐：
/// 目录忽略整棵跳过、skip_roots 整棵跳过、重解析点不跟随不产出、忽略规则一致。
#[cfg(all(windows, any(test, feature = "bench")))]
pub struct Win32Enumerator {
    matcher: IgnoreMatcher,
    skip_roots: Arc<Mutex<Vec<String>>>,
}

#[cfg(all(windows, any(test, feature = "bench")))]
impl Win32Enumerator {
    pub fn new(matcher: IgnoreMatcher, skip_roots: Arc<Mutex<Vec<String>>>) -> Self {
        Self {
            matcher,
            skip_roots,
        }
    }
}

#[cfg(all(windows, any(test, feature = "bench")))]
impl FileEnumerator for Win32Enumerator {
    fn enumerate(
        &self,
        root: &str,
        on_file: &mut dyn FnMut(FileEntry) -> bool,
    ) -> Result<EnumerateStats, String> {
        let mut stats = EnumerateStats::default();
        let skip_roots = self
            .skip_roots
            .lock()
            .map(|roots| roots.clone())
            .unwrap_or_default();
        let now_ms = now_millis();
        enumerate_win32(
            root,
            &self.matcher,
            &skip_roots,
            now_ms,
            &mut stats,
            on_file,
        )?;
        Ok(stats)
    }
}

/// 迭代式 DFS（显式栈，避免深目录递归爆栈）；`Ok(true)` 表示调用方要求提前停止。
#[cfg(all(windows, any(test, feature = "bench")))]
fn enumerate_win32(
    root: &str,
    matcher: &IgnoreMatcher,
    skip_roots: &[String],
    now_ms: i64,
    stats: &mut EnumerateStats,
    on_file: &mut dyn FnMut(FileEntry) -> bool,
) -> Result<bool, String> {
    let mut stack: Vec<String> = vec![root.trim_end_matches(['/', '\\']).to_string()];
    while let Some(path) = stack.pop() {
        let pattern: Vec<u16> = format!("{path}\\*")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut data = WIN32_FIND_DATAW::default();
        let handle = match unsafe { FindFirstFileW(PCWSTR(pattern.as_ptr()), &mut data) } {
            Ok(h) => h,
            // 空目录：FindFirstFileW("dir\*") 返回文件未找到，属正常。
            Err(e) if e.code() == ERROR_FILE_NOT_FOUND.into() => continue,
            Err(e) => {
                stats.errors += 1;
                log::debug!("scan: Win32 枚举失败 {path}: {e}");
                continue;
            }
        };
        let _guard = Win32FindHandle(handle);
        loop {
            let name = utf16_until_nul(&data.cFileName);
            if name != "." && name != ".." {
                let attrs = data.dwFileAttributes;
                let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY.0) != 0;
                let is_reparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT.0) != 0;
                let full = format!("{path}/{name}");
                if is_dir {
                    if !is_reparse && !matcher.is_ignored(&name) {
                        let norm = normalize_path(&full);
                        if !under_any(&norm, skip_roots) {
                            stack.push(norm.trim_end_matches(['/', '\\']).to_string());
                        }
                    }
                } else if !is_reparse {
                    if matcher.is_ignored(&name) {
                        stats.ignored += 1;
                    } else {
                        stats.discovered += 1;
                        let size =
                            (((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64) as i64;
                        let modified_ms = filetime_to_ms(data.ftLastWriteTime).unwrap_or(now_ms);
                        if !on_file(FileEntry {
                            path: normalize_path(&full),
                            size,
                            modified_ms,
                            is_dir: false,
                            is_symlink: false,
                        }) {
                            return Ok(true);
                        }
                    }
                }
            }
            match unsafe { FindNextFileW(handle, &mut data) } {
                Ok(()) => {}
                Err(e) if e.code() == ERROR_NO_MORE_FILES.into() => break,
                Err(e) => {
                    stats.errors += 1;
                    log::debug!("scan: Win32 枚举下一项失败 {path}: {e}");
                    break;
                }
            }
        }
    }
    Ok(false)
}

#[cfg(all(windows, any(test, feature = "bench")))]
fn utf16_until_nul(buf: &[u16]) -> String {
    let end = buf.iter().position(|&u| u == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

#[cfg(all(windows, any(test, feature = "bench")))]
fn filetime_to_ms(ft: FILETIME) -> Option<i64> {
    let raw = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    if raw == 0 {
        return None;
    }
    // FILETIME：自 1601-01-01 起 100ns；Unix 纪元偏移为 116444736000000000 * 100ns。
    let unix_100ns = raw.checked_sub(116444736000000000)?;
    Some((unix_100ns / 10_000) as i64)
}

#[cfg(all(windows, any(test, feature = "bench")))]
struct Win32FindHandle(HANDLE);

#[cfg(all(windows, any(test, feature = "bench")))]
impl Drop for Win32FindHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = FindClose(self.0);
        }
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

    #[cfg(windows)]
    #[test]
    fn win32_matches_walkdir_on_temp_tree() {
        let dir = temp_dir("win32");
        fs::create_dir_all(dir.join("proj")).unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("proj").join("main.rs"), b"x").unwrap();
        fs::write(dir.join("sub").join("a.txt"), b"x").unwrap();
        fs::write(dir.join("top.pdf"), b"x").unwrap();
        fs::write(dir.join("tmp.crdownload"), b"x").unwrap();
        let matcher = IgnoreMatcher::new();
        let skip = Arc::new(Mutex::new(vec![normalize_path(
            &dir.join("proj").to_string_lossy(),
        )]));
        let walk = WalkDirEnumerator::new(matcher.clone(), skip.clone());
        let win = Win32Enumerator::new(matcher, skip);
        let root = normalize_path(&dir.to_string_lossy());
        let (we, ws) = collect(&walk, &root);
        let (ve, vs) = collect(&win, &root);
        let mut a: Vec<String> = we.iter().map(|e| e.path.clone()).collect();
        let mut b: Vec<String> = ve.iter().map(|e| e.path.clone()).collect();
        a.sort();
        b.sort();
        assert_eq!(a, b, "路径集合应一致");
        assert_eq!(ws.discovered, vs.discovered);
        assert_eq!(ws.ignored, vs.ignored);
        assert_eq!(ws.errors, vs.errors);
        for (x, y) in we.iter().zip(ve.iter()) {
            assert_eq!(x.size, y.size, "大小应一致: {}", x.path);
        }
        fs::remove_dir_all(&dir).unwrap();
    }
}
