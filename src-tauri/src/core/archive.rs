//! 归档核心：目标规划、冲突唯一化、错误映射与操作记录模型。
//!
//! 纯逻辑与模型层，不依赖 Tauri；文件移动与索引/日志编排在
//! `infra/archive_engine.rs` 与命令层完成。
use crate::core::classify::Category;
use crate::core::error_codes::{
    code_of, coded, ARCHIVE_CROSS_DISK, ARCHIVE_LOCKED, ARCHIVE_NO_ROOT,
};
use crate::core::path::{is_subpath, normalize_path, path_key};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 一次批量归档中单文件的最大数量（超出要求收窄筛选）。
pub const MAX_BATCH_FILES: usize = 200;
/// 撤销记录保留的最近批次数。
pub const UNDO_KEEP_BATCHES: i64 = 200;
/// 自动归档队列容量。
pub const AUTO_QUEUE_CAPACITY: usize = 1000;
/// 项目归档目标子目录名。
pub const PROJECT_ARCHIVE_DIR: &str = "项目";
/// 失败阶段：归档（移动入库）。
pub const PHASE_ARCHIVE: &str = "archive";
/// 失败阶段：撤销（移回原位）。
pub const PHASE_UNDO: &str = "undo";

/// 归档操作（每个被移动的文件/项目一条，按 batch_id 聚合撤销）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveOp {
    pub id: i64,
    pub batch_id: i64,
    /// "file" | "project"
    pub kind: String,
    pub source: String,
    pub dest: String,
    pub created_at: i64,
    pub undone_at: Option<i64>,
}

/// 归档批次（“最近归档”列表条目）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBatch {
    pub batch_id: i64,
    pub kind: String,
    pub count: i64,
    pub created_at: i64,
    pub undone: bool,
    pub sample_dest: String,
}

/// 归档/撤销结果（部分失败保留成功项）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOutcome {
    pub batch_id: Option<i64>,
    pub archived: usize,
    pub failed: Vec<ArchiveFailure>,
    /// 成功移动的 source→dest 映射（dest 为 unique_dest 实际结果，含冲突改名）；
    /// 展示与撤销核对以此为准，前端不得自行推导目标路径。
    #[serde(default)]
    pub results: Vec<ArchiveMove>,
}

/// 一次成功的移动映射。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMove {
    pub source: String,
    pub dest: String,
}

/// 单条失败信息。`phase` 区分失败发生的阶段（"archive" | "undo"），
/// `path` 统一为被操作文件的本体路径（归档=源、撤销=归档目标）；
/// `code` 为注册表错误码（`error|code` 形状解析所得，未结构化的错误为 None）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFailure {
    pub path: String,
    pub error: String,
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// 构造失败信息：`phase` 标注阶段，错误串符合 `code|message` 形状时自动提取错误码。
pub fn failure(path: impl Into<String>, phase: &str, error: String) -> ArchiveFailure {
    ArchiveFailure {
        path: path.into(),
        code: code_of(&error).map(str::to_string),
        phase: phase.to_string(),
        error,
    }
}

/// 快捷方式归属记录（目标被归档移动后用于重建）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRecord {
    pub lnk_path: String,
    pub target_path: String,
}

/// 首个标签决定大类目录；无标签或未知标签回落 other。
pub fn category_dir(labels: &str) -> String {
    let first = labels.split(',').next().unwrap_or("").trim();
    if Category::ALL.iter().any(|c| c.key() == first) {
        first.to_string()
    } else {
        "other".to_string()
    }
}

/// 单文件目标：`root/<大类>/<文件名>`（root 先规范化；盘根如 `D:/` 去尾斜杠避免双斜杠）。
pub fn plan_file_target(root: &str, file_name: &str, labels: &str) -> Result<String, String> {
    let root = normalize_path(root);
    let root = root.trim_end_matches('/');
    if root.is_empty() {
        return Err(coded(ARCHIVE_NO_ROOT, "归档根目录未配置"));
    }
    if file_name.trim().is_empty() {
        return Err("文件名为空".to_string());
    }
    Ok(format!("{root}/{}/{}", category_dir(labels), file_name))
}

/// 冲突唯一化：已存在则 `name (2).ext` 递增，绝不覆盖。
pub fn unique_dest(dest: &Path) -> Result<PathBuf, String> {
    if !dest.exists() {
        return Ok(dest.to_path_buf());
    }
    let parent = dest.parent().unwrap_or_else(|| Path::new(""));
    let file_name = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let (stem, ext) = match dest.extension() {
        Some(ext) => {
            let stem = dest
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| file_name.clone());
            (stem, format!(".{}", ext.to_string_lossy()))
        }
        None => (file_name, String::new()),
    };
    let mut index = 2;
    loop {
        let candidate = parent.join(format!("{stem} ({index}){ext}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
        index += 1;
    }
}

/// 把移动失败映射为结构化错误串（跨卷/占用优先，携带注册表错误码）。
pub fn move_error(path: &str, err: std::io::Error) -> String {
    let code = err.raw_os_error();
    if err.kind() == std::io::ErrorKind::CrossesDevices || code == Some(17) {
        coded(
            ARCHIVE_CROSS_DISK,
            format!("{path}: 跨磁盘归档暂不支持，请把归档根放在同一磁盘"),
        )
    } else if code == Some(32) || code == Some(5) {
        coded(
            ARCHIVE_LOCKED,
            format!("{path}: 文件可能被占用，请关闭相关程序后重试"),
        )
    } else {
        format!("{path}: {err}")
    }
}

/// 归档源归属校验：路径必须等于或位于任一根（监控/项目目录）之内，防越权路径。
pub fn is_owned_path(path: &str, roots: &[String]) -> bool {
    let path = normalize_path(path);
    if path.is_empty() {
        return false;
    }
    let key = path_key(&path);
    roots.iter().any(|root| {
        let root = normalize_path(root);
        if root.is_empty() {
            return false;
        }
        let root_key = path_key(&root);
        key == root_key || is_subpath(&path, &root)
    })
}

/// 源与目标互相包含（含相等）时拒绝，防止目录移进自身 / 归档根位于源内部。
pub fn target_collides(source: &str, dest: &str) -> bool {
    let source = normalize_path(source);
    let dest = normalize_path(dest);
    if source.is_empty() || dest.is_empty() {
        return true;
    }
    path_key(&source) == path_key(&dest) || is_subpath(&dest, &source) || is_subpath(&source, &dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rootup_archive_core_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn category_dir_uses_first_known_category() {
        assert_eq!(category_dir("document,course"), "document");
        assert_eq!(category_dir("image"), "image");
        assert_eq!(category_dir(""), "other");
        assert_eq!(category_dir("course"), "other");
        assert_eq!(category_dir("other"), "other");
    }

    #[test]
    fn plan_file_target_builds_category_path() {
        assert_eq!(
            plan_file_target("C:/Archive", "a.pdf", "document").unwrap(),
            "C:/Archive/document/a.pdf"
        );
        assert_eq!(
            plan_file_target("", "a.pdf", "document").unwrap_err(),
            "archive.no_root|归档根目录未配置"
        );
        assert_eq!(
            plan_file_target("C:/Archive", "  ", "document").unwrap_err(),
            "文件名为空"
        );
    }

    #[test]
    fn archive_dest_fixture_cases() {
        let raw = include_str!("../../../fixtures/archive-dest-cases.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/archive-dest-cases.json 应可解析");
        for case in value["cases"].as_array().expect("cases 应为数组") {
            let root = case["root"].as_str().unwrap();
            let labels = case["labels"].as_str().unwrap();
            let name = case["name"].as_str().unwrap();
            let expected = case["dest"].as_str().unwrap();
            assert_eq!(
                plan_file_target(root, name, labels).unwrap(),
                expected,
                "root={root} labels={labels}"
            );
        }
    }

    #[test]
    fn unique_dest_increments_without_overwrite() {
        let root = temp_root("unique");
        fs::write(root.join("a.pdf"), "1").unwrap();
        fs::write(root.join("a (2).pdf"), "2").unwrap();
        let dest = unique_dest(&root.join("a.pdf")).unwrap();
        assert_eq!(dest.file_name().unwrap(), "a (3).pdf");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_error_maps_cross_device_and_busy() {
        let e17 = std::io::Error::from_raw_os_error(17);
        let msg = move_error("C:/a", e17);
        assert!(msg.contains("跨磁盘"));
        assert!(msg.starts_with("archive.cross_disk|"));
        let e32 = std::io::Error::from_raw_os_error(32);
        let msg = move_error("C:/a", e32);
        assert!(msg.contains("占用"));
        assert!(msg.starts_with("archive.locked|"));
        let e = std::io::Error::other("boom");
        assert!(move_error("C:/a", e).contains("boom"));
    }

    #[test]
    fn failure_extracts_code_and_keeps_phase() {
        let f = failure(
            "C:/a.pdf",
            "archive",
            move_error("C:/a.pdf", std::io::Error::from_raw_os_error(17)),
        );
        assert_eq!(f.phase, "archive");
        assert_eq!(f.code.as_deref(), Some("archive.cross_disk"));
        let plain = failure("C:/a.pdf", "undo", "普通错误".to_string());
        assert_eq!(plain.code, None);
        assert_eq!(plain.phase, "undo");
    }

    #[test]
    fn is_owned_path_accepts_root_and_children_only() {
        let roots = vec!["C:/Watch".to_string(), "D:/Projects".to_string()];
        assert!(is_owned_path("C:/Watch", &roots));
        assert!(is_owned_path("C:/Watch/sub/a.pdf", &roots));
        assert!(is_owned_path("d:/projects/app", &roots), "大小写不敏感");
        assert!(
            !is_owned_path("C:/Watch2/a.pdf", &roots),
            "同名前缀不算子路径"
        );
        assert!(!is_owned_path("E:/Other/a.pdf", &roots));
        assert!(!is_owned_path("", &roots));
        assert!(!is_owned_path("C:/Watch/a.pdf", &[]));
    }

    #[test]
    fn target_collides_rejects_self_and_nesting() {
        assert!(target_collides("C:/a", "C:/a"));
        assert!(target_collides("C:/proj", "C:/proj/项目/proj"));
        assert!(!target_collides("C:/a", "C:/Archive/a"));
        assert!(!target_collides("C:/a.pdf", "C:/Archive/document/a.pdf"));
        assert!(target_collides("", "C:/Archive"));
    }
}
