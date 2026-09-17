//! 错误码注册表（0.8.8）：稳定 `code` + 分级 + 用户可读文案的契约真源镜像。
//!
//! 真源为 `fixtures/error-codes.json`；错误串沿用 `code|message` 结构化前缀
//! （与 `lib/errors.ts` 的 `errorCode` 口径一致），本模块提供 Rust 侧常量与
//! 分级查询，双端测试断言与 fixture 一致。
use serde::Deserialize;
use std::collections::HashMap;

/// 归档根未配置。
pub const ARCHIVE_NO_ROOT: &str = "archive.no_root";
/// 归档源不在监控/项目目录内（命令层归属校验）。
pub const ARCHIVE_FORBIDDEN: &str = "archive.forbidden";
/// 已识别软件目录禁止整树移动（风险确认后放行；0.8.8 归档安全收口消费）。
pub const ARCHIVE_SOFTWARE_PROTECTED: &str = "archive.software_protected";
// 以下码由 0.8.8 后续模块（回收站删除 / 智能解压 / 监听注册）消费，
// 先随注册表落地（与 FTS_SCHEMA 同款保留策略）。
/// 文件不在索引中或状态不允许归档。
pub const ARCHIVE_NOT_INDEXED: &str = "archive.not_indexed";
/// 源与目标互相包含。
pub const ARCHIVE_TARGET_COLLIDES: &str = "archive.target_collides";
/// 跨磁盘移动。
pub const ARCHIVE_CROSS_DISK: &str = "archive.cross_disk";
/// 文件被占用。
pub const ARCHIVE_LOCKED: &str = "archive.locked";
/// 索引更新失败（文件已还原）。
pub const ARCHIVE_INDEX_WRITE_FAILED: &str = "archive.index_write_failed";
/// 撤销冲突（源已存在/目标缺失）。
pub const ARCHIVE_UNDO_CONFLICT: &str = "archive.undo_conflict";
/// 单批数量超上限。
pub const ARCHIVE_TOO_MANY: &str = "archive.too_many";
/// 移入回收站失败。
#[cfg_attr(not(test), allow(dead_code))]
pub const DELETE_FAILED: &str = "delete.failed";
/// 删除时被占用。
#[cfg_attr(not(test), allow(dead_code))]
pub const DELETE_LOCKED: &str = "delete.locked";
/// 非受支持压缩包。
#[cfg_attr(not(test), allow(dead_code))]
pub const EXTRACT_NOT_ARCHIVE: &str = "extract.not_archive";
/// 压缩包条目路径越界。
#[cfg_attr(not(test), allow(dead_code))]
pub const EXTRACT_PATH_TRAVERSAL: &str = "extract.path_traversal";
/// 疑似压缩炸弹。
#[cfg_attr(not(test), allow(dead_code))]
pub const EXTRACT_BOMB_SUSPECTED: &str = "extract.bomb_suspected";
/// 条目数超限。
#[cfg_attr(not(test), allow(dead_code))]
pub const EXTRACT_TOO_MANY_ENTRIES: &str = "extract.too_many_entries";
/// 解压失败。
#[cfg_attr(not(test), allow(dead_code))]
pub const EXTRACT_FAILED: &str = "extract.failed";
/// 归档根位于受保护位置（设置保存拦截）。
pub const ARCHIVE_GUARD_BLOCKED: &str = "archive_guard.blocked";
/// 监听注册失败。
#[cfg_attr(not(test), allow(dead_code))]
pub const WATCH_REGISTER_FAILED: &str = "watch.register_failed";

/// 错误分级：可重试 / 可忽略 / 需用户介入。
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Retryable,
    Ignorable,
    NeedsUser,
}

#[derive(Debug, Deserialize)]
struct RegistryEntry {
    code: String,
    severity: Severity,
}

#[derive(Debug, Deserialize)]
struct Registry {
    /// 分级全集（测试断言三级齐备；生产查询走 codes）。
    #[cfg_attr(not(test), allow(dead_code))]
    severities: Vec<String>,
    codes: Vec<RegistryEntry>,
}

fn registry() -> &'static HashMap<&'static str, Severity> {
    use std::sync::OnceLock;
    static REGISTRY: OnceLock<HashMap<&'static str, Severity>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let raw: Registry =
            serde_json::from_str(include_str!("../../../fixtures/error-codes.json"))
                .expect("fixtures/error-codes.json 应可解析");
        raw.codes
            .into_iter()
            .map(|entry| (leak(entry.code), entry.severity))
            .collect()
    })
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

/// 查询错误码分级；未注册返回 None（前端按 needs_user 兜底展示）。
#[cfg_attr(not(test), allow(dead_code))]
pub fn severity(code: &str) -> Option<Severity> {
    registry().get(code).copied()
}

/// 以 `code|message` 形式构造结构化错误串。
pub fn coded(code: &str, message: impl AsRef<str>) -> String {
    format!("{code}|{}", message.as_ref())
}

/// 从错误串提取错误码；不符合 `code|` 形状返回 None。
pub fn code_of(error: &str) -> Option<&str> {
    let (code, _) = error.split_once('|')?;
    if code.is_empty()
        || !code.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        || !code
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        return None;
    }
    Some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_covers_registered_constants() {
        for code in [
            ARCHIVE_NO_ROOT,
            ARCHIVE_FORBIDDEN,
            ARCHIVE_SOFTWARE_PROTECTED,
            ARCHIVE_NOT_INDEXED,
            ARCHIVE_TARGET_COLLIDES,
            ARCHIVE_CROSS_DISK,
            ARCHIVE_LOCKED,
            ARCHIVE_INDEX_WRITE_FAILED,
            ARCHIVE_UNDO_CONFLICT,
            ARCHIVE_TOO_MANY,
            DELETE_FAILED,
            DELETE_LOCKED,
            EXTRACT_NOT_ARCHIVE,
            EXTRACT_PATH_TRAVERSAL,
            EXTRACT_BOMB_SUSPECTED,
            EXTRACT_TOO_MANY_ENTRIES,
            EXTRACT_FAILED,
            ARCHIVE_GUARD_BLOCKED,
            WATCH_REGISTER_FAILED,
        ] {
            assert!(severity(code).is_some(), "{code} 未注册");
        }
    }

    #[test]
    fn fixture_severities_are_the_three_levels() {
        let raw: Registry =
            serde_json::from_str(include_str!("../../../fixtures/error-codes.json")).unwrap();
        assert_eq!(raw.severities, vec!["retryable", "ignorable", "needs_user"]);
    }

    #[test]
    fn code_of_parses_and_rejects_shapes() {
        assert_eq!(code_of("archive.locked|文件被占用"), Some("archive.locked"));
        assert_eq!(
            code_of("archive_guard.blocked|drive_root"),
            Some("archive_guard.blocked")
        );
        assert_eq!(code_of("普通错误消息"), None);
        assert_eq!(code_of("|缺少码"), None);
        assert_eq!(code_of("Bad Shape|大写"), None);
    }

    #[test]
    fn coded_round_trips() {
        let err = coded(ARCHIVE_CROSS_DISK, "跨磁盘");
        assert_eq!(code_of(&err), Some(ARCHIVE_CROSS_DISK));
        assert!(err.ends_with("跨磁盘"));
    }
}
