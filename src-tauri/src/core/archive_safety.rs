//! 归档安全前置（0.8.8 收口）：预检统计 / 软件单元冲突 / 整树移动引用报告。
//!
//! 纯逻辑 + std::fs 直读（与 core/archive.rs 同先例）；目录行走设上限防失控，
//! `truncated` 显式告知前端「统计不完整」而非静默截断。
use crate::core::path::{is_subpath, path_key};
use serde::Serialize;

/// 单次预检统计的最大条目数（文件 + 目录累计）；超出即 truncated=true。
pub const MAX_SCAN_ENTRIES: u64 = 50_000;

/// 预检统计：数量 / 体积 / 可执行文件 / 动态库 / 符号链接。
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStats {
    pub count: u64,
    pub total_size: i64,
    pub exe_count: u64,
    pub dll_count: u64,
    pub symlink_count: u64,
    pub truncated: bool,
}

/// 递归统计所选路径（文件或目录树）；单条路径读取失败按缺失处理不阻断。
pub fn scan_paths(paths: &[String], max_entries: u64) -> PathStats {
    let mut stats = PathStats::default();
    let mut stack: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
    while let Some(current) = stack.pop() {
        if stats.count >= max_entries {
            stats.truncated = true;
            break;
        }
        let Ok(meta) = std::fs::symlink_metadata(&current) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            stats.symlink_count += 1;
            stats.count += 1;
            continue;
        }
        if meta.is_dir() {
            stats.count += 1;
            match std::fs::read_dir(&current) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        stack.push(entry.path());
                    }
                }
                Err(_) => continue,
            }
            continue;
        }
        stats.count += 1;
        stats.total_size += meta.len() as i64;
        let ext = current
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "exe" => stats.exe_count += 1,
            "dll" => stats.dll_count += 1,
            _ => {}
        }
    }
    stats
}

/// 软件单元冲突：源与任一软件单元相同、源在软件单元内部、或软件单元在源内部
/// （移动父目录同样会把软件单元整树搬走）。
pub fn software_conflicts(sources: &[String], software_units: &[String]) -> Vec<String> {
    let mut conflicts: Vec<String> = Vec::new();
    for source in sources {
        let s = path_key(source);
        for unit in software_units {
            let u = path_key(unit);
            let hit = s == u || is_subpath(&s, &u) || is_subpath(&u, &s);
            if hit && !conflicts.contains(unit) {
                conflicts.push(unit.clone());
            }
        }
    }
    conflicts
}

/// 整树移动引用报告：指向源树内部的快捷方式（重建/失效风险）。
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceReport {
    /// 受影响的快捷方式 lnk 路径
    pub shortcuts: Vec<String>,
}

/// 汇总指向源树内部的快捷方式（target 命中任一源：相等或位于其内部）。
pub fn reference_report(sources: &[String], shortcuts: &[(String, String)]) -> ReferenceReport {
    let mut report = ReferenceReport::default();
    for (lnk_path, target) in shortcuts {
        let t = path_key(target);
        let hit = sources.iter().any(|s| {
            let s = path_key(s);
            t == s || is_subpath(&t, &s)
        });
        if hit && !report.shortcuts.contains(lnk_path) {
            report.shortcuts.push(lnk_path.clone());
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rootup_archive_safety_{tag}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn software_conflicts_covers_both_directions() {
        let units = vec!["C:/Watch/SomeApp".to_string()];
        let conflicts = software_conflicts(
            &[
                "C:/Watch/SomeApp".to_string(),
                "C:/Watch/SomeApp/App".to_string(),
                "C:/Watch".to_string(),
                "C:/Watch/other".to_string(),
            ],
            &units,
        );
        // 相同 / 内部 / 包含父树 三种都冲突；无关目录不冲突
        assert!(conflicts.contains(&"C:/Watch/SomeApp".to_string()));
        // C:/Watch 包含软件单元 → 冲突（unit 本身出现在结果里）
        assert!(conflicts.contains(&"C:/Watch/SomeApp".to_string()));
        assert!(!conflicts.iter().any(|p| p.ends_with("other")));
        // 大小写不敏感
        let lower = software_conflicts(&["c:/watch/someapp".to_string()], &units);
        assert_eq!(lower.len(), 1);
    }

    #[test]
    fn reference_report_finds_shortcuts_into_tree() {
        let report = reference_report(
            &["C:/Watch/Proj".to_string()],
            &[
                (
                    "C:/Users/x/Desktop/proj.lnk".to_string(),
                    "C:/Watch/Proj/app.exe".to_string(),
                ),
                (
                    "C:/Users/x/Desktop/outer.lnk".to_string(),
                    "C:/Other/tool.exe".to_string(),
                ),
                (
                    "C:/Users/x/Desktop/root.lnk".to_string(),
                    "C:/watch/proj".to_string(),
                ),
            ],
        );
        assert_eq!(
            report.shortcuts,
            vec![
                "C:/Users/x/Desktop/proj.lnk".to_string(),
                "C:/Users/x/Desktop/root.lnk".to_string(),
            ]
        );
    }

    #[test]
    fn scan_paths_counts_files_sizes_and_kinds() {
        let dir = temp_dir("scan");
        let tree = dir.join("tree");
        std::fs::create_dir_all(tree.join("sub")).unwrap();
        std::fs::write(tree.join("app.exe"), "12345").unwrap();
        std::fs::write(tree.join("lib.dll"), "12").unwrap();
        std::fs::write(tree.join("readme.txt"), "1").unwrap();
        std::fs::write(tree.join("sub").join("run.exe"), "1234").unwrap();
        let root = normalize_like(&tree);
        let stats = scan_paths(&[root], MAX_SCAN_ENTRIES);
        assert_eq!(stats.count, 6, "tree + sub + 4 files");
        assert_eq!(stats.total_size, 12);
        assert_eq!(stats.exe_count, 2);
        assert_eq!(stats.dll_count, 1);
        assert_eq!(stats.symlink_count, 0);
        assert!(!stats.truncated);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_paths_reports_truncation_at_cap() {
        let dir = temp_dir("cap");
        let tree = dir.join("many");
        std::fs::create_dir_all(&tree).unwrap();
        for i in 0..5 {
            std::fs::write(tree.join(format!("f{i}.txt")), "x").unwrap();
        }
        let stats = scan_paths(&[normalize_like(&tree)], 3);
        assert!(stats.truncated);
        assert!(stats.count >= 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_paths_missing_path_is_skipped() {
        let stats = scan_paths(&["C:/definitely/missing/rootup".to_string()], 100);
        assert_eq!(stats, PathStats::default());
    }

    fn normalize_like(path: &std::path::Path) -> String {
        crate::core::path::normalize_path(&path.to_string_lossy())
    }
}
