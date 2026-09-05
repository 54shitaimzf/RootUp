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

/// 目录缺失判定（Windows ERROR_FILE_NOT_FOUND=2 / ERROR_PATH_NOT_FOUND=3）。
/// 其余错误（权限、网络、占用）一律不动索引，只记录。
pub fn is_missing_dir_error(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(2) | Some(3))
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

/// `path` 是否位于任一 `roots` 之下（含自身），用于跳过集判定。
pub fn under_any(path: &str, roots: &[String]) -> bool {
    let key = path_key(path);
    roots.iter().any(|root| {
        let root_key = path_key(root);
        key == root_key || is_subpath(path, root)
    })
}

/// 目录输入最大长度（含环境变量展开后）。
pub const MAX_DIR_LEN: usize = 260;

/// Windows 保留设备名（组件级，忽略扩展名）。
pub const RESERVED_DIR_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 展开 `%NAME%` 环境变量；未闭合或未知变量返回错误。
pub fn expand_env_vars(input: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = input;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            return Err("未闭合的环境变量引用".to_string());
        };
        let name = &after[..end];
        let value = std::env::var(name).map_err(|_| format!("未知环境变量: {name}"))?;
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// 目录输入统一校验：清洗 → 环境变量展开 → 规范化 → 长度/非法字符/保留名/盘根检查。
pub fn validate_dir_path(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("目录不能为空".to_string());
    }
    let expanded = expand_env_vars(trimmed)?;
    let normalized = normalize_path(&expanded);
    if normalized.is_empty() {
        return Err("目录不能为空".to_string());
    }
    if normalized.len() > MAX_DIR_LEN {
        return Err(format!("路径过长（>{MAX_DIR_LEN}）"));
    }
    if normalized
        .chars()
        .any(|c| c.is_control() || matches!(c, '"' | '<' | '>' | '|' | '?' | '*'))
    {
        return Err("路径包含非法字符".to_string());
    }
    for part in normalized.split('/').filter(|p| !p.is_empty()) {
        let upper = part.to_ascii_uppercase();
        let base = upper.split('.').next().unwrap_or("");
        if RESERVED_DIR_NAMES.contains(&base) {
            return Err(format!("路径包含保留名: {part}"));
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Err(format!("路径组件不能以点或空格结尾: {part}"));
        }
        if part.chars().count() > 255 {
            return Err("路径组件过长".to_string());
        }
    }
    if is_drive_root(&normalized) {
        return Err("不能监控磁盘根目录".to_string());
    }
    Ok(normalized)
}

/// 盘根判定（`C:/`、`/`）。监控目录与归档根校验共用。
pub fn is_drive_root(path: &str) -> bool {
    path == "/" || (path.len() == 3 && path.as_bytes()[1] == b':' && path.ends_with('/'))
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
    fn under_any_matches_self_and_children() {
        let roots = vec!["C:/Archive".to_string()];
        assert!(under_any("C:/Archive", &roots));
        assert!(under_any("C:/Archive/Doc/a.pdf", &roots));
        assert!(under_any("c:/archive/doc", &roots));
        assert!(!under_any("C:/Archive2", &roots));
        assert!(!under_any("C:/Other/a.pdf", &roots));
        assert!(!under_any("", &roots));
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

    #[test]
    fn validate_dir_path_rejects_bad_input() {
        assert!(validate_dir_path("").is_err());
        assert!(validate_dir_path("   ").is_err());
        assert!(validate_dir_path("C:/bad|pipe").is_err());
        assert!(validate_dir_path("C:/bad?query").is_err());
        assert!(validate_dir_path("C:/CON").is_err());
        assert!(validate_dir_path("C:/COM1/x").is_err());
        assert!(validate_dir_path("C:/trailing./x").is_err());
        assert!(validate_dir_path("C:/trailing /x").is_err());
        assert!(validate_dir_path("C:/").is_err());
        assert!(validate_dir_path("/").is_err());
        assert!(validate_dir_path("C:/unknown%VAR%x").is_err());
    }

    #[test]
    fn validate_dir_path_normalizes_and_expands() {
        let value = validate_dir_path("C:/Users/Admin\\Downloads/").unwrap();
        assert_eq!(value, "C:/Users/Admin/Downloads");
        let expanded = validate_dir_path("%USERPROFILE%\\Desktop").unwrap();
        let profile = std::env::var("USERPROFILE").unwrap_or_default();
        assert!(path_key(&expanded).starts_with(&path_key(&profile)));
    }

    #[test]
    fn expand_env_vars_handles_unclosed_and_unknown() {
        assert!(expand_env_vars("C:/%NOPE%/x").is_err());
        assert!(expand_env_vars("C:/%broken").is_err());
        assert_eq!(expand_env_vars("C:/plain").unwrap(), "C:/plain");
    }
}
