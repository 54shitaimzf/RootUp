//! 初始化扫描的纯逻辑：事件模型、快照差集、删除风暴守卫与记录构造。
use crate::core::classify::{Classifier, ClassifyInput};
use crate::core::index::FileRecord;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// 扫描进度（节流推送）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub dir: String,
    pub discovered: usize,
    pub processed: usize,
    pub ignored: usize,
    pub errors: usize,
}

/// 扫描完成摘要（写日志与事件）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub dir: String,
    pub discovered: usize,
    pub added: usize,
    pub updated: usize,
    pub ignored: usize,
    pub errors: usize,
    pub missing_deleted: i64,
    pub elapsed_ms: u128,
    pub files_per_sec: f64,
    pub cancelled: bool,
}

/// 扫描事件：经 ScanEventSink 广播（Tauri 侧 emit，测试侧收集）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ScanEvent {
    Progress { progress: ScanProgress },
    Finished { summary: ScanSummary },
    Failed { dir: String, error: String },
    Cancelled { summary: ScanSummary },
}

/// 事件接收接口：与 Tauri 解耦，测试可注入记录型实现。
pub trait ScanEventSink: Send + Sync {
    fn on_event(&self, event: ScanEvent);
}

/// 扫描参数：默认值面向生产，测试注入小值。
#[derive(Debug, Clone)]
pub struct ScanParams {
    /// 批量事务大小
    pub batch_size: usize,
    /// 进度事件节流间隔（处理文件数）
    pub progress_interval: usize,
    /// 删除风暴守卫比例（相对快照数）
    pub deletion_guard_ratio: f64,
    /// 删除风暴守卫下限（绝对条数）
    pub deletion_guard_min: usize,
}

impl Default for ScanParams {
    fn default() -> Self {
        Self {
            batch_size: 500,
            progress_interval: 2000,
            deletion_guard_ratio: 0.25,
            deletion_guard_min: 500,
        }
    }
}

impl ScanParams {
    /// 删除风暴守卫阈值：候选超过该值视为异常（磁盘断连/目录移动等）。
    pub fn deletion_guard(&self, snapshot_len: usize) -> usize {
        let by_ratio = (snapshot_len as f64 * self.deletion_guard_ratio).ceil() as usize;
        by_ratio.max(self.deletion_guard_min)
    }
}

/// 快照差集：快照中存在但本次扫描未发现的路径（返回原始存储路径）。
pub fn diff_missing(snapshot: &HashMap<String, String>, scanned: &HashSet<String>) -> Vec<String> {
    snapshot
        .iter()
        .filter(|(key, _)| !scanned.contains(*key))
        .map(|(_, original)| original.clone())
        .collect()
}

/// 从文件系统信息构造索引记录并应用分类器。
pub fn record_from_scan(
    path: &str,
    size: i64,
    modified_ms: i64,
    now_ms: i64,
    classifier: &dyn Classifier,
) -> FileRecord {
    let mut record = FileRecord::new(path, size, now_ms, "indexed");
    record.modified = modified_ms;
    let labels = classifier.labels(&ClassifyInput {
        name: &record.name,
        file_type: &record.file_type,
        path,
        size: size.max(0) as u64,
    });
    // 写入前校验：只保留合法标签 key
    record.labels = labels
        .into_iter()
        .filter(|l| crate::core::classify::is_valid_label_key(l))
        .collect::<Vec<_>>()
        .join(",");
    record
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::classify::ExtensionClassifier;

    #[test]
    fn diff_missing_returns_snapshot_minus_scanned() {
        let mut snapshot = HashMap::new();
        snapshot.insert("c:/a.txt".into(), "C:/a.txt".into());
        snapshot.insert("c:/b.txt".into(), "C:/b.txt".into());
        let mut scanned = HashSet::new();
        scanned.insert("c:/a.txt".into());
        let missing = diff_missing(&snapshot, &scanned);
        assert_eq!(missing, vec!["C:/b.txt".to_string()]);
    }

    #[test]
    fn diff_missing_empty_cases() {
        let snapshot = HashMap::new();
        assert!(diff_missing(&snapshot, &HashSet::new()).is_empty());
        let mut snapshot = HashMap::new();
        snapshot.insert("c:/a".into(), "C:/a".into());
        let mut scanned = HashSet::new();
        scanned.insert("c:/a".into());
        assert!(diff_missing(&snapshot, &scanned).is_empty());
    }

    #[test]
    fn newly_created_file_not_in_snapshot_is_never_missing() {
        // 扫描期间新建的文件不在开始快照中，差集天然不含它
        let snapshot = HashMap::new();
        let mut scanned = HashSet::new();
        scanned.insert("c:/new.txt".into());
        assert!(diff_missing(&snapshot, &scanned).is_empty());
    }

    #[test]
    fn deletion_guard_bounds() {
        let params = ScanParams::default();
        assert_eq!(params.deletion_guard(0), 500);
        assert_eq!(params.deletion_guard(100), 500);
        assert_eq!(params.deletion_guard(2000), 500);
        assert_eq!(params.deletion_guard(10000), 2500);
    }

    #[test]
    fn record_from_scan_applies_labels_and_modified() {
        let classifier = ExtensionClassifier;
        let record = record_from_scan("C:/x/notes.pdf", 1024, 999, 1000, &classifier);
        assert_eq!(record.name, "notes.pdf");
        assert_eq!(record.file_type, "pdf");
        assert_eq!(record.labels, "document");
        assert_eq!(record.modified, 999);
        assert_eq!(record.state, "indexed");
    }

    #[test]
    fn record_from_scan_unknown_type_has_empty_labels() {
        let classifier = ExtensionClassifier;
        let record = record_from_scan("C:/x/Makefile", 1, 1, 2, &classifier);
        assert_eq!(record.labels, "");
    }
}
