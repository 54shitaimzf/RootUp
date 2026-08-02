//! 监视目录集合的规范化与防重叠处理（纯函数，供命令层与启动自愈复用）。
use crate::core::path::{is_subpath, normalize_path, path_key};
use std::collections::HashSet;

/// 添加目录的校验结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddCheck {
    /// 与现有目录相同（幂等）
    Duplicate,
    /// 已被该目录覆盖
    CoveredBy(String),
    /// 将覆盖这些现有子目录
    WillCover(Vec<String>),
    /// 可正常添加
    Ok,
}

/// 校验新目录相对现有列表的包含关系（现有列表按规范化路径比较）。
pub fn check_add(new_dir: &str, existing: &[String]) -> AddCheck {
    let new_n = normalize_path(new_dir);
    if new_n.is_empty() {
        return AddCheck::CoveredBy(String::new());
    }
    for parent in existing {
        if path_key(&new_n) == path_key(parent) {
            return AddCheck::Duplicate;
        }
        if is_subpath(&new_n, parent) {
            return AddCheck::CoveredBy(normalize_path(parent));
        }
    }
    let covered: Vec<String> = existing
        .iter()
        .filter(|d| is_subpath(d, &new_n))
        .map(|d| normalize_path(d))
        .collect();
    if covered.is_empty() {
        AddCheck::Ok
    } else {
        AddCheck::WillCover(covered)
    }
}

/// 规范化 + 去重 + 保留父目录移除子目录（启动自愈）。
/// 返回（修正后的列表, 修正记录 [(被移除目录, 保留的父目录)]）。
pub fn dedupe_watched(dirs: &[String]) -> (Vec<String>, Vec<(String, String)>) {
    let mut normalized: Vec<String> = dirs
        .iter()
        .map(|d| normalize_path(d))
        .filter(|d| !d.is_empty())
        .collect();
    // 父目录（路径段更少）排前，保证先保留父
    normalized.sort_by_key(|d| (d.matches('/').count(), d.len()));

    let mut kept: Vec<String> = Vec::new();
    let mut fixes: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for dir in normalized {
        let key = path_key(&dir);
        if !seen.insert(key) {
            continue;
        }
        if let Some(parent) = kept.iter().find(|p| is_subpath(&dir, p)) {
            fixes.push((dir.clone(), parent.clone()));
            continue;
        }
        let removed: Vec<String> = kept
            .iter()
            .filter(|d| is_subpath(d, &dir))
            .cloned()
            .collect();
        for sub in &removed {
            fixes.push((sub.clone(), dir.clone()));
        }
        kept.retain(|d| !is_subpath(d, &dir));
        kept.push(dir);
    }
    (kept, fixes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_add_duplicate_is_idempotent() {
        let existing = vec!["C:/Downloads".to_string()];
        assert_eq!(check_add(r"C:\Downloads\", &existing), AddCheck::Duplicate);
        assert_eq!(check_add("c:/downloads", &existing), AddCheck::Duplicate);
    }

    #[test]
    fn check_add_child_is_covered() {
        let existing = vec!["C:/Downloads".to_string()];
        assert_eq!(
            check_add("C:/Downloads/Courses", &existing),
            AddCheck::CoveredBy("C:/Downloads".to_string())
        );
    }

    #[test]
    fn check_add_parent_will_cover_children() {
        let existing = vec![
            "C:/Downloads/Courses".to_string(),
            "C:/Downloads/Music".to_string(),
        ];
        assert_eq!(
            check_add("C:/Downloads", &existing),
            AddCheck::WillCover(vec![
                "C:/Downloads/Courses".to_string(),
                "C:/Downloads/Music".to_string()
            ])
        );
    }

    #[test]
    fn check_add_sibling_is_ok() {
        let existing = vec!["C:/Downloads".to_string()];
        assert_eq!(check_add("C:/Desktop", &existing), AddCheck::Ok);
        // 前缀相似但非包含（B vs B2）
        let existing = vec!["C:/A/B".to_string()];
        assert_eq!(check_add("C:/A/B2", &existing), AddCheck::Ok);
    }

    #[test]
    fn dedupe_keeps_parent_removes_children() {
        let dirs = vec![
            "C:/Downloads/Courses".to_string(),
            "C:/Downloads".to_string(),
            "C:/Downloads/Music".to_string(),
        ];
        let (kept, fixes) = dedupe_watched(&dirs);
        assert_eq!(kept, vec!["C:/Downloads".to_string()]);
        assert_eq!(fixes.len(), 2);
        assert!(fixes.contains(&(
            "C:/Downloads/Courses".to_string(),
            "C:/Downloads".to_string()
        )));
        assert!(fixes.contains(&("C:/Downloads/Music".to_string(), "C:/Downloads".to_string())));
    }

    #[test]
    fn dedupe_handles_duplicates_case_and_slashes() {
        let dirs = vec![
            "C:/Downloads".to_string(),
            r"C:\Downloads\".to_string(),
            "c:/downloads".to_string(),
        ];
        let (kept, fixes) = dedupe_watched(&dirs);
        assert_eq!(kept.len(), 1);
        assert!(fixes.is_empty());
    }

    #[test]
    fn dedupe_keeps_disjoint_dirs() {
        let dirs = vec!["C:/A".to_string(), "D:/B".to_string()];
        let (kept, fixes) = dedupe_watched(&dirs);
        assert_eq!(kept.len(), 2);
        assert!(fixes.is_empty());
    }

    #[test]
    fn dedupe_drops_empty_paths() {
        let dirs = vec!["".to_string(), "C:/A".to_string()];
        let (kept, fixes) = dedupe_watched(&dirs);
        assert_eq!(kept, vec!["C:/A".to_string()]);
        assert!(fixes.is_empty());
    }
}
