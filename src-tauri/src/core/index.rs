//! 索引模型与存储契约：上层只依赖 trait，不依赖具体存储。

use serde::Serialize;

/// 文件索引记录（与数据库表 `files` 对应）。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileRecord {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub size: i64,
    pub file_type: String,
    pub labels: String,
    pub first_seen: i64,
    pub modified: i64,
    pub state: String,
}

impl FileRecord {
    /// 从路径与基础信息构造记录（id 由存储层分配）。
    pub fn new(path: &str, size: i64, first_seen: i64, state: &str) -> Self {
        let path_ref = std::path::Path::new(path);
        let name = path_ref
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
        let file_type = path_ref
            .extension()
            .map(|s| s.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        Self {
            id: 0,
            path: path.to_string(),
            name,
            size,
            file_type,
            labels: String::new(),
            first_seen,
            modified: first_seen,
            state: state.to_string(),
        }
    }
}

/// 索引存储契约：实现可替换（SQLite / 内存 / 未来其他后端）。
pub trait IndexStore: Send + Sync {
    /// 插入或按 path 更新（幂等）。
    fn upsert(&mut self, record: &FileRecord) -> Result<(), String>;
    fn get_by_path(&self, path: &str) -> Result<Option<FileRecord>, String>;
    /// 最近优先列表（limit/offset 分页）。
    fn list(&self, limit: i64, offset: i64) -> Result<Vec<FileRecord>, String>;
    /// 按名称/路径模糊搜索。
    fn search(&self, query: &str, limit: i64) -> Result<Vec<FileRecord>, String>;
    fn mark_deleted(&mut self, path: &str) -> Result<(), String>;
    #[cfg_attr(not(test), allow(dead_code))]
    fn count(&self) -> Result<i64, String>;
}
