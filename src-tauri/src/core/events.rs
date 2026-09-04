//! 文件事件归一化与状态机（纯逻辑，无 IO、无框架依赖）。

use std::path::PathBuf;
use std::time::Duration;

/// 应用级事件名常量（真源为 fixtures/app-contracts.json，双端测试断言一致；
/// 前端镜像为 src/lib/events.ts）。emit/listen 一律使用常量，禁止裸字符串。
pub const EVENT_SCAN_PROGRESS: &str = "scan-progress";
pub const EVENT_SCAN_FINISHED: &str = "scan-finished";
pub const EVENT_FILES_CHANGED: &str = "files-changed";
pub const EVENT_SETTINGS_CHANGED: &str = "settings-changed";
pub const EVENT_CLOSE_REQUESTED: &str = "close-requested";
pub const EVENT_PROJECT_OPEN: &str = "project-open";
pub const EVENT_STUDY_HOMEWORK_OPEN: &str = "study-homework-open";

/// 全部应用级事件名（fixture 一致性测试枚举用）。
#[cfg_attr(not(test), allow(dead_code))]
pub fn all_app_events() -> [&'static str; 7] {
    [
        EVENT_SCAN_PROGRESS,
        EVENT_SCAN_FINISHED,
        EVENT_FILES_CHANGED,
        EVENT_SETTINGS_CHANGED,
        EVENT_CLOSE_REQUESTED,
        EVENT_PROJECT_OPEN,
        EVENT_STUDY_HOMEWORK_OPEN,
    ]
}

/// 归一化后的事件类型（由平台事件转换而来）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileEventKind {
    Created,
    RenamedTo,
    RenamedFrom,
    Removed,
    Modified,
    Other,
}

/// 归一化事件：只保留业务需要的字段。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedEvent {
    pub path: PathBuf,
    pub kind: FileEventKind,
    pub is_dir: bool,
}

/// 文件状态（索引与生命周期跟踪）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// 状态机契约：Archived/Pending 供迭代 B 归档使用；测试目标中它们被直接引用。
#[cfg_attr(not(test), allow(dead_code))]
pub enum FileState {
    /// 已出现，等待稳定确认
    Pending,
    /// 已确认稳定并写入索引
    Indexed,
    /// 已归档（迭代 B 使用）
    Archived,
    /// 已从磁盘删除
    Deleted,
}

impl FileState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Indexed => "indexed",
            Self::Archived => "archived",
            Self::Deleted => "deleted",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "indexed" => Some(Self::Indexed),
            "archived" => Some(Self::Archived),
            "deleted" => Some(Self::Deleted),
            _ => None,
        }
    }
}

/// 稳定确认参数（集中管理，便于调整与测试）。
#[derive(Debug, Clone)]
pub struct StabilityParams {
    /// 首次采样前的等待时间
    pub first_sample_delay: Duration,
    /// 两次采样间隔
    pub sample_gap: Duration,
    /// 超过该时间强制视为稳定（兜底，避免漏文件）
    pub force_timeout: Duration,
    /// 事件去抖窗口
    pub debounce_window: Duration,
}

impl Default for StabilityParams {
    fn default() -> Self {
        Self {
            first_sample_delay: Duration::from_secs(3),
            sample_gap: Duration::from_secs(1),
            force_timeout: Duration::from_secs(60),
            debounce_window: Duration::from_secs(2),
        }
    }
}

/// 稳定判定结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stability {
    Stable,
    Unstable,
    /// 超时兜底：即使仍在变化也强制上报，避免漏文件
    ForceStable,
}

/// 判定文件是否已稳定。
///
/// - 超过 `force_timeout` → `ForceStable`
/// - 两次采样大小一致且文件可打开 → `Stable`
/// - 其余情况 → `Unstable`
pub fn judge_stability(
    previous_size: Option<u64>,
    current_size: u64,
    openable: bool,
    elapsed_since_first_seen: Duration,
    params: &StabilityParams,
) -> Stability {
    if elapsed_since_first_seen >= params.force_timeout {
        return Stability::ForceStable;
    }
    if openable && previous_size == Some(current_size) {
        return Stability::Stable;
    }
    Stability::Unstable
}

/// 状态迁移：返回事件发生后应进入的状态；`None` 表示不迁移/终态。
///
/// 规则：
/// - 已删除的文件不再响应任何事件；
/// - 删除事件使 pending/indexed/archived 进入 deleted；
/// - renamed-from 使 indexed/archived 进入 deleted（旧路径已不存在），
///   pending 尚无记录，不产生迁移；
/// - created / modified / renamed-to 保持原状态（记录更新由上层负责）。
#[cfg_attr(not(test), allow(dead_code))]
pub fn next_state(from: FileState, event: &NormalizedEvent) -> Option<FileState> {
    match (from, event.kind) {
        (FileState::Deleted, _) => None,
        (_, FileEventKind::Other) => None,
        (FileState::Pending, FileEventKind::Removed) => Some(FileState::Deleted),
        (
            FileState::Indexed | FileState::Archived,
            FileEventKind::Removed | FileEventKind::RenamedFrom,
        ) => Some(FileState::Deleted),
        (FileState::Pending, FileEventKind::RenamedFrom) => None,
        (_, FileEventKind::Created | FileEventKind::Modified | FileEventKind::RenamedTo) => {
            Some(from)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Instant;

    #[test]
    fn app_event_names_match_fixture() {
        let raw = include_str!("../../../fixtures/app-contracts.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/app-contracts.json 应可解析");
        let events = value["events"].as_object().expect("events 应为对象");
        for name in all_app_events() {
            assert!(
                events.values().any(|v| v.as_str() == Some(name)),
                "fixture 缺少事件 {name}"
            );
        }
        // 常量与 fixture 一一对应：fixture 中不允许出现常量未覆盖的事件
        assert_eq!(events.len(), all_app_events().len(), "事件数应与常量一致");
    }

    fn ev(kind: FileEventKind) -> NormalizedEvent {
        NormalizedEvent {
            path: PathBuf::from("/tmp/a.pdf"),
            kind,
            is_dir: false,
        }
    }

    #[test]
    fn state_round_trip() {
        for state in [
            FileState::Pending,
            FileState::Indexed,
            FileState::Archived,
            FileState::Deleted,
        ] {
            assert_eq!(FileState::from_str(state.as_str()), Some(state));
        }
        assert_eq!(FileState::from_str("unknown"), None);
    }

    #[test]
    fn create_keep_modify_keep_rename_to_keep() {
        let pending = FileState::Pending;
        assert_eq!(
            next_state(pending, &ev(FileEventKind::Created)),
            Some(FileState::Pending)
        );
        assert_eq!(
            next_state(FileState::Indexed, &ev(FileEventKind::Modified)),
            Some(FileState::Indexed)
        );
        assert_eq!(
            next_state(FileState::Indexed, &ev(FileEventKind::RenamedTo)),
            Some(FileState::Indexed)
        );
        assert_eq!(
            next_state(FileState::Archived, &ev(FileEventKind::Created)),
            Some(FileState::Archived)
        );
    }

    #[test]
    fn removed_moves_to_deleted() {
        for from in [FileState::Pending, FileState::Indexed, FileState::Archived] {
            assert_eq!(
                next_state(from, &ev(FileEventKind::Removed)),
                Some(FileState::Deleted)
            );
        }
    }

    #[test]
    fn deleted_is_terminal() {
        for kind in [
            FileEventKind::Created,
            FileEventKind::Modified,
            FileEventKind::Removed,
            FileEventKind::RenamedTo,
            FileEventKind::RenamedFrom,
        ] {
            assert_eq!(next_state(FileState::Deleted, &ev(kind)), None);
        }
    }

    #[test]
    fn other_does_not_migrate() {
        assert_eq!(
            next_state(FileState::Indexed, &ev(FileEventKind::Other)),
            None
        );
    }

    #[test]
    fn renamed_from_marks_indexed_and_archived_deleted() {
        for from in [FileState::Indexed, FileState::Archived] {
            assert_eq!(
                next_state(from, &ev(FileEventKind::RenamedFrom)),
                Some(FileState::Deleted)
            );
        }
        assert_eq!(
            next_state(FileState::Pending, &ev(FileEventKind::RenamedFrom)),
            None
        );
    }

    #[test]
    fn stability_judgement() {
        let params = StabilityParams::default();
        // 大小一致且可打开 → 稳定
        assert_eq!(
            judge_stability(Some(100), 100, true, Duration::from_secs(4), &params),
            Stability::Stable
        );
        // 大小变化 → 不稳定
        assert_eq!(
            judge_stability(Some(100), 200, true, Duration::from_secs(4), &params),
            Stability::Unstable
        );
        // 大小一致但不可打开 → 不稳定
        assert_eq!(
            judge_stability(Some(100), 100, false, Duration::from_secs(4), &params),
            Stability::Unstable
        );
        // 超时兜底 → 强制稳定
        assert_eq!(
            judge_stability(Some(100), 200, false, Duration::from_secs(61), &params),
            Stability::ForceStable
        );
        // 首次采样（无历史大小）→ 不稳定
        assert_eq!(
            judge_stability(None, 100, true, Duration::from_secs(4), &params),
            Stability::Unstable
        );
    }

    #[test]
    fn default_params_are_expected() {
        let p = StabilityParams::default();
        assert_eq!(p.first_sample_delay, Duration::from_secs(3));
        assert_eq!(p.sample_gap, Duration::from_secs(1));
        assert_eq!(p.force_timeout, Duration::from_secs(60));
        assert_eq!(p.debounce_window, Duration::from_secs(2));
    }

    #[test]
    fn full_state_event_matrix() {
        use FileEventKind::*;
        use FileState::*;
        let kinds = [Created, Modified, RenamedTo, RenamedFrom, Removed, Other];
        for from in [Pending, Indexed, Archived, Deleted] {
            for kind in kinds {
                let expected = match (from, kind) {
                    (Deleted, _) => None,
                    (_, Other) => None,
                    (Pending, Removed) => Some(Deleted),
                    (Indexed | Archived, Removed | RenamedFrom) => Some(Deleted),
                    (Pending, RenamedFrom) => None,
                    (_, Created | Modified | RenamedTo) => Some(from),
                };
                assert_eq!(
                    next_state(from, &ev(kind)),
                    expected,
                    "状态迁移决策表 ({from:?}, {kind:?})"
                );
            }
        }
    }

    #[test]
    fn stability_boundaries() {
        let params = StabilityParams::default();
        // elapsed 恰等于 force_timeout → 强制稳定
        assert_eq!(
            judge_stability(Some(1), 2, false, params.force_timeout, &params),
            Stability::ForceStable
        );
        // 大小恰好相等且可打开 → 稳定
        assert_eq!(
            judge_stability(Some(5), 5, true, Duration::from_secs(1), &params),
            Stability::Stable
        );
        // 大小差 1 → 不稳定
        assert_eq!(
            judge_stability(Some(5), 6, true, Duration::from_secs(1), &params),
            Stability::Unstable
        );
    }

    #[test]
    fn instant_is_importable() {
        // 保证模块对外暴露的类型可被上层使用（watcher 采样时间）
        let _now = Instant::now();
    }
}
