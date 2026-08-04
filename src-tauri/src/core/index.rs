//! 索引模型与存储契约：上层只依赖 trait，不依赖具体存储。

use serde::Serialize;

use crate::core::archive::{ArchiveBatch, ArchiveOp, ShortcutRecord};
use crate::core::query::{parse_query, FileQuery, QueryPage};

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
    #[allow(dead_code)]
    fn list(&self, limit: i64, offset: i64) -> Result<Vec<FileRecord>, String>;
    /// 全量记录（定向重分类用，排除 deleted）。
    fn all_records(&self) -> Result<Vec<FileRecord>, String>;
    /// 仅更新 labels 列（保留 first_seen/modified）。
    fn update_labels(&mut self, path: &str, labels: &str) -> Result<(), String>;
    /// 批量仅更新 labels 列（单事务，保留 first_seen/modified）。
    fn update_labels_batch(&mut self, updates: &[(String, String)]) -> Result<(), String> {
        for (path, labels) in updates {
            self.update_labels(path, labels)?;
        }
        Ok(())
    }
    /// 按名称/路径模糊搜索。
    #[allow(dead_code)]
    fn search(&self, text: &str, limit: i64) -> Result<Vec<FileRecord>, String> {
        let mut query = parse_query(text);
        query.limit = limit;
        query.offset = 0;
        Ok(self.query(&query)?.items)
    }
    /// 结构化查询（过滤 + 分页 + 总数）。
    fn query(&self, query: &FileQuery) -> Result<QueryPage, String>;
    /// 批量幂等写入（单事务）。
    fn upsert_many(&mut self, records: &[FileRecord]) -> Result<(), String>;
    /// 返回某目录（含子目录）下非 deleted 的路径列表（差集快照用）。
    fn paths_with_prefix(&self, dir: &str) -> Result<Vec<String>, String>;
    /// 批量标记 deleted（单事务），返回实际变更数。
    fn mark_missing(&mut self, paths: &[String]) -> Result<i64, String>;
    /// 库中现存标签 key 列表（去重排序）。
    fn list_labels(&self) -> Result<Vec<String>, String>;
    fn mark_deleted(&mut self, path: &str) -> Result<(), String>;
    /// 事务内把一条记录的路径迁移到新路径并改状态（归档/撤销用）。
    fn move_record(&mut self, from: &str, to: &str, state: &str) -> Result<(), String>;
    /// 把任一 root（含子路径）下非 deleted 的历史记录标为 deleted，幂等。
    fn mark_under_roots_deleted(&mut self, roots: &[String]) -> Result<i64, String>;
    /// 写入一条归档操作，返回自增 id。
    fn insert_archive_op(&mut self, op: &ArchiveOp) -> Result<i64, String>;
    /// 最近批次列表（按创建时间倒序）。
    fn list_archive_batches(&self, limit: i64) -> Result<Vec<ArchiveBatch>, String>;
    /// 某批次全部操作（含已撤销）。
    fn ops_for_batch(&self, batch_id: i64) -> Result<Vec<ArchiveOp>, String>;
    /// 标记指定操作已撤销。
    fn mark_ops_undone(&mut self, ids: &[i64]) -> Result<(), String>;
    /// 只保留最近 keep 个批次（旧记录删除）。
    fn prune_archive_ops(&mut self, keep: i64) -> Result<(), String>;
    /// 登记/更新快捷方式归属（lnk 唯一）。
    fn upsert_shortcut(
        &mut self,
        lnk_path: &str,
        target_path: &str,
        created_at: i64,
    ) -> Result<(), String>;
    /// 目标路径位于 root（含子路径）下的快捷方式记录。
    fn shortcuts_under(&self, root: &str) -> Result<Vec<ShortcutRecord>, String>;
    /// 更新一条快捷方式的目标路径。
    fn update_shortcut_target(&mut self, lnk_path: &str, target_path: &str) -> Result<(), String>;
    #[cfg_attr(not(test), allow(dead_code))]
    fn count(&self) -> Result<i64, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(path: &str) -> FileRecord {
        FileRecord::new(path, 10, 1, "indexed")
    }

    #[test]
    fn extracts_name_and_type() {
        let r = rec("C:/Courses/math notes.pdf");
        assert_eq!(r.name, "math notes.pdf");
        assert_eq!(r.file_type, "pdf");
    }

    #[test]
    fn multi_extension_uses_last() {
        let r = rec("C:/x/archive.tar.gz");
        assert_eq!(r.file_type, "gz");
        assert_eq!(r.name, "archive.tar.gz");
    }

    #[test]
    fn no_extension() {
        let r = rec("C:/x/Makefile");
        assert_eq!(r.file_type, "");
        assert_eq!(r.name, "Makefile");
    }

    #[test]
    fn hidden_file_has_no_extension() {
        let r = rec("C:/x/.gitignore");
        assert_eq!(r.file_type, "");
        assert_eq!(r.name, ".gitignore");
    }

    #[test]
    fn uppercase_extension_lowercased() {
        let r = rec("C:/x/IMG.PNG");
        assert_eq!(r.file_type, "png");
    }

    #[test]
    fn unicode_path() {
        let r = rec("C:/课件/高等数学.pdf");
        assert_eq!(r.name, "高等数学.pdf");
        assert_eq!(r.file_type, "pdf");
    }

    #[test]
    fn trailing_slash_uses_dir_name() {
        let r = rec("C:/x/");
        assert_eq!(r.name, "x");
        assert_eq!(r.file_type, "");
    }

    #[test]
    fn empty_path_yields_empty_fields() {
        let r = rec("");
        assert_eq!(r.name, "");
        assert_eq!(r.file_type, "");
    }

    // 已知限制：FileRecord::new 以 &str 接收路径，非 UTF-8 路径暂不支持
    // （若未来需要，改为接收 &Path 并保留 OsStr 原始字节）
}
