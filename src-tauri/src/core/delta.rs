//! 增量数据源契约（0.8.6 阶段一）：USN 补账与未来其他增量源共用。

/// 增量事件类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeltaKind {
    Created,
    Modified,
    /// 保留给未来配对迁移（0.8.8）；当前重命名按“旧路径删除 + 新路径创建”展开
    #[allow(dead_code)]
    Renamed,
    Deleted,
}

/// 一条增量记录：路径均指监控根下的完整路径。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeltaRecord {
    pub kind: DeltaKind,
    pub path: String,
    /// Renamed 时的新路径（旧路径在 path 字段）
    pub new_path: Option<String>,
    /// Created/Modified 的文件大小（由实现方补元数据）
    pub size: Option<i64>,
    /// 修改时间（毫秒）
    pub modified_ms: Option<i64>,
}

impl DeltaRecord {
    pub fn deleted(path: impl Into<String>) -> Self {
        Self {
            kind: DeltaKind::Deleted,
            path: path.into(),
            new_path: None,
            size: None,
            modified_ms: None,
        }
    }

    pub fn created(path: impl Into<String>) -> Self {
        Self {
            kind: DeltaKind::Created,
            path: path.into(),
            new_path: None,
            size: None,
            modified_ms: None,
        }
    }
}

/// 增量数据源：begin → next 迭代 → commit 落游标。
/// 实现方负责权限探测与降级（失败返回 Err 由调用方回退）。
pub trait DeltaSource: Send + Sync {
    fn begin(&mut self) -> Result<(), String>;
    fn next(&mut self) -> Result<Option<DeltaRecord>, String>;
    fn commit(&mut self) -> Result<(), String>;
}
