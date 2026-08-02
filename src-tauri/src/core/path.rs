//! 路径规范化与包含关系判定：所有入库、差集、前缀匹配、目录去重统一走这里。

/// 规范化路径：统一分隔符为 `/`、去除末尾分隔符（保留盘符根与 `/` 根）。
pub fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut s = trimmed.replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    // 盘符根（C:/）去尾斜杠后是 "C:"，补回斜杠保持根的语义
    if s.len() == 2 && s.ends_with(':') {
        s.push('/');
    }
    s
}

/// 用于比较的规范化键：Windows 不区分大小写，其余平台保持原样。
pub fn path_key(path: &str) -> String {
    let normalized = normalize_path(path);
    #[cfg(windows)]
    {
        normalized.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        normalized
    }
}

/// `child` 是否为 `parent` 的严格子路径（按路径段比较，平台大小写规则）。
pub fn is_subpath(child: &str, parent: &str) -> bool {
    let child_n = normalize_path(child);
    let parent_n = normalize_path(parent);
    if child_n.is_empty() || parent_n.is_empty() {
        return false;
    }
    let child_parts: Vec<String> = child_n
        .split('/')
        .filter(|s| !s.is_empty())
        .map(path_key)
        .collect();
    let parent_parts: Vec<String> = parent_n
        .split('/')
        .filter(|s| !s.is_empty())
        .map(path_key)
        .collect();
    if child_parts.len() <= parent_parts.len() {
        return false;
    }
    child_parts[..parent_parts.len()] == parent_parts[..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_separators_and_trailing_slashes() {
        assert_eq!(normalize_path(r"C:\Users\X\"), "C:/Users/X");
        assert_eq!(normalize_path("C:/Users/X//"), "C:/Users/X");
        assert_eq!(normalize_path(r"C:\"), "C:/");
        assert_eq!(normalize_path("/"), "/");
        assert_eq!(normalize_path(""), "");
        assert_eq!(normalize_path("  "), "");
        assert_eq!(normalize_path("relative/dir/"), "relative/dir");
    }

    #[test]
    fn path_key_is_case_insensitive_on_windows() {
        let upper = path_key("C:/Users/Admin");
        let lower = path_key("c:/users/admin");
        #[cfg(windows)]
        assert_eq!(upper, lower);
        #[cfg(not(windows))]
        assert_ne!(upper, lower);
    }

    #[test]
    fn subpath_matches_component_wise() {
        assert!(is_subpath("C:/Users/X/Y", "C:/Users/X"));
        assert!(is_subpath("/a/b/c", "/a/b"));
        assert!(!is_subpath("C:/Users/X2", "C:/Users/X"));
        assert!(!is_subpath("C:/Users/X", "C:/Users/X"));
        assert!(!is_subpath("C:/Users/X", "C:/Users/X/Y"));
        assert!(!is_subpath("C:/Users/X", "/C:/Users/X"));
        assert!(!is_subpath("", "/a"));
    }

    #[test]
    fn subpath_is_case_insensitive_on_windows() {
        assert!(is_subpath("C:/Users/X/Y", "c:/users/x"));
        assert!(!is_subpath("C:/Users/X2/Y", "c:/users/x"));
    }

    #[test]
    fn subpath_respects_drive_and_root() {
        assert!(is_subpath("C:/x", "C:/"));
        assert!(!is_subpath("D:/x", "C:/"));
        assert!(is_subpath("/x/y", "/"));
    }
}
