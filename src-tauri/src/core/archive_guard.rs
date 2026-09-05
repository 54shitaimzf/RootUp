//! 归档根安全评估：把「归档根选在哪」从自由输入变成有安全语义的判定。
//!
//! 三级：
//! - `blocked`：系统目录树（Windows / Program Files / ProgramData）、
//!   软件存盘区（AppData 三分支整树，含 Temp 与 `LocalAppData\Programs`）、
//!   盘根——这些位置作归档根会危害系统 / 软件数据，后端直接拒绝；
//! - `warn`：用户核心目录本身（用户根、桌面、文档、下载等一级目录）——
//!   归档库会与日常文件混放，前端需二次确认；
//! - `safe`：其余位置，含上述目录的**子目录**——
//!   「在文档下新建 `RootUp 档案库`」正是推荐的无关紧要位置。
//!
//! 规则真源在本文件；`fixtures/archive-guard-cases.json` 锁定判定矩阵，
//! 前端不复算规则，只消费 `assess_archive_root` 命令结果做展示分级。
use crate::core::path::{expand_env_vars, is_drive_root, normalize_path, path_key};
use serde::Serialize;

/// 评估结果：等级（safe / warn / blocked）+ 原因标识（前端映射 i18n；safe 时为 None）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveAssessment {
    pub level: &'static str,
    pub reason: Option<String>,
}

/// 受保护目录树（任意盘符下的第二段）：整树 blocked。
const BLOCKED_TREES: &[&str] = &[
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
];

/// AppData 树（`users/<name>/appdata` 及其全部子树）：整树 blocked。
const APPDATA_SEGMENT: &str = "appdata";

/// 用户核心目录（`users/<name>/<dir>` 一级）：本身 warn，子目录 safe。
const USER_CORE_DIRS: &[&str] = &[
    "desktop",
    "documents",
    "downloads",
    "pictures",
    "music",
    "videos",
    "onedrive",
    "favorites",
    "links",
    "searches",
    "saved games",
    "contacts",
];

fn assessment(level: &'static str, reason: Option<&str>) -> ArchiveAssessment {
    ArchiveAssessment {
        level,
        reason: reason.map(str::to_string),
    }
}

/// 评估归档根路径。输入经环境变量展开与分隔符归一；空路径视为 safe
/// （归档根未配置是合法状态，由 `require_root` 另行提示）。
pub fn assess_archive_root(input: &str) -> ArchiveAssessment {
    let normalized = match expand_env_vars(input.trim()) {
        Ok(expanded) => normalize_path(&expanded),
        Err(_) => return assessment("blocked", Some("invalid_path")),
    };
    if normalized.is_empty() {
        return assessment("safe", None);
    }
    if is_drive_root(&normalized) {
        return assessment("blocked", Some("drive_root"));
    }
    let segments: Vec<String> = normalized
        .split('/')
        .filter(|s| !s.is_empty())
        .map(path_key)
        .collect();
    if segments.len() < 2 {
        // UNC 根或异常短路径：无法确认归属，按 blocked 处理
        return assessment("blocked", Some("invalid_path"));
    }
    // 盘符段（`c:`）之后的第一段决定树归属
    let first = segments[1].as_str();
    if BLOCKED_TREES.contains(&first) {
        return assessment("blocked", Some("protected_tree"));
    }
    if first == "users" {
        // `users/<name>/...`
        if segments.len() >= 4 && segments[3] == APPDATA_SEGMENT {
            return assessment("blocked", Some("appdata_tree"));
        }
        if segments.len() == 3 {
            return assessment("warn", Some("user_profile"));
        }
        if segments.len() == 4 && USER_CORE_DIRS.contains(&segments[3].as_str()) {
            return assessment("warn", Some("user_core_dir"));
        }
        if segments.len() == 5
            && segments[3] == "onedrive"
            && USER_CORE_DIRS.contains(&segments[4].as_str())
        {
            return assessment("warn", Some("user_core_dir"));
        }
    }
    assessment("safe", None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_cases_match_fixture() {
        let raw = include_str!("../../../fixtures/archive-guard-cases.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/archive-guard-cases.json 应可解析");
        for case in value["cases"].as_array().expect("cases 应为数组") {
            let input = case["input"].as_str().expect("用例应有 input");
            let expected_level = case["level"].as_str().expect("用例应有 level");
            let expected_reason = case["reason"].as_str();
            let got = assess_archive_root(input);
            assert_eq!(
                got.level, expected_level,
                "用例 {input} 等级不符（reason={:?}）",
                got.reason
            );
            assert_eq!(
                got.reason.as_deref(),
                expected_reason,
                "用例 {input} 原因不符"
            );
        }
    }

    #[test]
    fn blocked_rejects_system_and_software_trees() {
        for path in [
            "C:/Windows/Temp",
            "C:/Windows",
            "d:/Program Files/SomeApp",
            "C:/ProgramData/chocolatey",
            "C:/Users/Admin/AppData/Local",
            "C:/Users/Admin/AppData/Roaming/RootUp",
            "C:/Users/Admin/AppData/Local/Temp",
            "%LOCALAPPDATA%/Programs",
            "D:\\",
            "C:/",
        ] {
            let got = assess_archive_root(path);
            assert_eq!(
                got.level, "blocked",
                "{path} 应为 blocked（{:?}）",
                got.reason
            );
        }
    }

    #[test]
    fn warn_covers_user_core_dirs_themselves_only() {
        for path in [
            "C:/Users/Admin",
            "C:/Users/Admin/Desktop",
            "C:/Users/Admin/Documents",
            "C:/Users/Admin/Downloads",
            "c:/users/x/onedrive/desktop",
        ] {
            let got = assess_archive_root(path);
            assert_eq!(got.level, "warn", "{path} 应为 warn（{:?}）", got.reason);
        }
        // 核心目录的子目录是 safe —— 推荐位置形态
        for path in [
            "C:/Users/Admin/Documents/RootUp 档案库",
            "C:/Users/Admin/Desktop/Archive",
        ] {
            let got = assess_archive_root(path);
            assert_eq!(got.level, "safe", "{path} 应为 safe");
        }
    }

    #[test]
    fn safe_covers_neutral_locations_and_empty() {
        for path in ["", "   ", "D:/RootUpArchive", "E:/data/archive"] {
            let got = assess_archive_root(path);
            assert_eq!(got.level, "safe", "{path} 应为 safe（{:?}）", got.reason);
        }
    }

    #[test]
    fn case_and_separator_insensitive() {
        let lower = assess_archive_root("c:/windows/temp");
        let upper = assess_archive_root("C:\\WINDOWS\\Temp");
        assert_eq!(lower, upper);
        assert_eq!(lower.level, "blocked");
    }
}
