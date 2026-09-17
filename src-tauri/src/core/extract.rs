//! 智能解压安全边界（0.8.8）：zip 优先支持，纯校验与计划逻辑。
//!
//! 三道防线（错误码见 error-codes.json）：
//! 1. 路径穿越：条目名绝对路径 / `..` 分量 / 盘符 → 拒绝该条目（整体失败，宁缺勿滥）；
//! 2. 解压炸弹：总解压体积超限或压缩比超阈值 → 拒绝解压；
//! 3. 条目数超限 → 拒绝解压。
use crate::core::error_codes::{
    coded, EXTRACT_BOMB_SUSPECTED, EXTRACT_NOT_ARCHIVE, EXTRACT_PATH_TRAVERSAL,
    EXTRACT_TOO_MANY_ENTRIES,
};
use serde::Serialize;

/// 单包条目数上限。
pub const MAX_ENTRIES: usize = 10_000;
/// 单包总解压体积上限（字节）。
pub const MAX_TOTAL_UNCOMPRESSED: u64 = 1024 * 1024 * 1024;
/// 压缩比上限（uncompressed/compressed，仅对有意义的 compressed 体积生效）。
pub const MAX_RATIO: u64 = 200;
/// 压缩比检查的最小条目体积（低于此值不做比值判定，避免小文件误报）。
pub const RATIO_MIN_COMPRESSED: u64 = 64;

/// 解压目标扩展名白名单（v1 仅 zip；其余回落 extract.not_archive）。
pub fn is_supported_archive(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".zip")
}

/// 条目元数据快照（先整体校验后解压，两阶段防炸弹）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ZipEntryMeta {
    /// 压缩包内原始条目名（含目录前缀与 /）。
    pub name: String,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub is_dir: bool,
}

/// 解压计划（校验通过后执行）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExtractPlan {
    /// 需要落盘的文件条目（目录条目随路径隐式创建）
    pub files: Vec<ZipEntryMeta>,
    pub total_uncompressed: u64,
}

fn extract_error(code: &str, message: &str) -> String {
    coded(code, message)
}

/// 条目名 → 相对路径分量序列；穿越形态返回 None（绝对路径 / `..` / 盘符 / 空段）。
pub fn safe_entry_components(name: &str) -> Option<Vec<String>> {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return None;
    }
    let mut components = Vec::new();
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        // Windows 盘符（如 C:）与保留字符形态直接拒绝
        if part.len() >= 2 && part.as_bytes()[1] == b':' {
            return None;
        }
        components.push(part.to_string());
    }
    if components.is_empty() {
        None
    } else {
        Some(components)
    }
}

/// 两阶段校验：条目清单先过安全边界，通过后返回解压计划。
pub fn plan_extract(entries: &[ZipEntryMeta]) -> Result<ExtractPlan, String> {
    if entries.len() > MAX_ENTRIES {
        return Err(extract_error(
            EXTRACT_TOO_MANY_ENTRIES,
            &format!(
                "压缩包含 {} 个条目，超过 {} 上限",
                entries.len(),
                MAX_ENTRIES
            ),
        ));
    }
    let mut files = Vec::new();
    let mut total: u64 = 0;
    for entry in entries {
        if safe_entry_components(&entry.name).is_none() {
            return Err(extract_error(
                EXTRACT_PATH_TRAVERSAL,
                &format!("条目路径越界: {}", entry.name),
            ));
        }
        total = total.saturating_add(entry.uncompressed_size);
        if total > MAX_TOTAL_UNCOMPRESSED {
            return Err(extract_error(
                EXTRACT_BOMB_SUSPECTED,
                &format!(
                    "总解压体积超过 {} MB 上限",
                    MAX_TOTAL_UNCOMPRESSED / 1024 / 1024
                ),
            ));
        }
        if entry.compressed_size >= RATIO_MIN_COMPRESSED
            && entry.uncompressed_size / entry.compressed_size > MAX_RATIO
        {
            return Err(extract_error(
                EXTRACT_BOMB_SUSPECTED,
                &format!("条目压缩比异常: {}", entry.name),
            ));
        }
        if !entry.is_dir {
            files.push(entry.clone());
        }
    }
    Ok(ExtractPlan {
        files,
        total_uncompressed: total,
    })
}

/// 非压缩包错误（扩展名白名单）。
pub fn not_archive_error(path: &str) -> String {
    extract_error(EXTRACT_NOT_ARCHIVE, &format!("暂不支持解压该类型: {path}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::error_codes::code_of;

    fn entry(name: &str, compressed: u64, uncompressed: u64, is_dir: bool) -> ZipEntryMeta {
        ZipEntryMeta {
            name: name.to_string(),
            compressed_size: compressed,
            uncompressed_size: uncompressed,
            is_dir,
        }
    }

    #[test]
    fn safe_entry_components_rejects_traversal_forms() {
        assert!(safe_entry_components("docs/a.txt").is_some());
        assert!(safe_entry_components("docs\\a.txt").is_some());
        assert_eq!(
            safe_entry_components("docs/./a.txt"),
            Some(vec!["docs".to_string(), "a.txt".to_string()])
        );
        assert!(safe_entry_components("../evil.txt").is_none());
        assert!(safe_entry_components("docs/../../evil.txt").is_none());
        assert!(safe_entry_components("/abs/path.txt").is_none());
        assert!(safe_entry_components("C:/evil.txt").is_none());
        assert!(safe_entry_components("dir/").is_some(), "目录条目保留段");
    }

    #[test]
    fn plan_extract_rejects_unsupported_and_limits() {
        // 非白名单扩展（命令层判定），此处只验证错误形状
        let err = not_archive_error("C:/x.rar");
        assert_eq!(code_of(&err), Some(EXTRACT_NOT_ARCHIVE));
        // 条目数超限
        let many: Vec<ZipEntryMeta> = (0..=MAX_ENTRIES)
            .map(|i| entry(&format!("f{i}.txt"), 10, 10, false))
            .collect();
        assert_eq!(
            code_of(&plan_extract(&many).unwrap_err()),
            Some(EXTRACT_TOO_MANY_ENTRIES)
        );
        // 总体积超限（两条 600MB）
        let bomb = vec![
            entry("a.bin", 600 * 1024 * 1024, 600 * 1024 * 1024, false),
            entry("b.bin", 600 * 1024 * 1024, 600 * 1024 * 1024, false),
        ];
        assert_eq!(
            code_of(&plan_extract(&bomb).unwrap_err()),
            Some(EXTRACT_BOMB_SUSPECTED)
        );
    }

    #[test]
    fn plan_extract_rejects_ratio_bomb_and_traversal() {
        // 压缩比炸弹：64 压缩 → 64*201 解压
        let bomb = vec![entry("bomb.txt", 64, 64 * 201, false)];
        assert_eq!(
            code_of(&plan_extract(&bomb).unwrap_err()),
            Some(EXTRACT_BOMB_SUSPECTED)
        );
        // 小压缩体积不做比值判定（RATIO_MIN_COMPRESSED 以下）
        let tiny = vec![entry("tiny.txt", 10, 10_000, false)];
        assert!(plan_extract(&tiny).is_ok());
        // 穿越条目整体失败
        let evil = vec![
            entry("ok.txt", 10, 10, false),
            entry("../evil", 0, 0, false),
        ];
        assert_eq!(
            code_of(&plan_extract(&evil).unwrap_err()),
            Some(EXTRACT_PATH_TRAVERSAL)
        );
    }

    #[test]
    fn plan_extract_returns_files_and_total() {
        let plan = plan_extract(&[
            entry("dir/", 0, 0, true),
            entry("dir/a.txt", 10, 100, false),
            entry("b.txt", 5, 50, false),
        ])
        .unwrap();
        assert_eq!(plan.files.len(), 2);
        assert_eq!(plan.total_uncompressed, 150);
        assert_eq!(plan.files[0].name, "dir/a.txt");
    }
}
