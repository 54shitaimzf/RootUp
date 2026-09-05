//! 文件索引的 SQLite 实现。

use crate::core::archive::{ArchiveBatch, ArchiveOp, ShortcutRecord};
use crate::core::events::FileState;
use crate::core::index::{FileRecord, IndexStore, ScanDiffStore};
use crate::core::query::{decode_cursor, encode_cursor, FileQuery, QueryPage};
use crate::core::scan::ScanDiffSummary;
use crate::infra::time::now_millis;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Mutex;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    file_type TEXT NOT NULL DEFAULT '',
    labels TEXT NOT NULL DEFAULT '',
    first_seen INTEGER NOT NULL,
    modified INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    deleted_at INTEGER
);
"#;

/// 0.8.5 索引集（schema v4）：存量库迁移与全新库共用同一份幂等语句。
/// name/labels 为前导通配 LIKE（`%x%`）无法利用索引；state_modified 组合索引在
/// `state !=` 范围条件下不能支撑 ORDER BY modified，实际排序与 COUNT 分别由
/// idx_files_modified / idx_files_state 承担，故只保留三个索引并删除其余。
const INDEX_SCHEMA: &str = r#"
CREATE INDEX IF NOT EXISTS idx_files_state ON files(state, deleted_at);
CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type COLLATE NOCASE);
DROP INDEX IF EXISTS idx_files_state_modified;
DROP INDEX IF EXISTS idx_files_name;
DROP INDEX IF EXISTS idx_files_size;
DROP INDEX IF EXISTS idx_files_labels;
"#;

/// 0.8.6 阶段一（schema v5）：USN 增量对账的卷状态持久化。
const USN_STATE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS usn_state (
    volume TEXT PRIMARY KEY,
    last_usn INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
"#;

/// FTS5 contentless + trigram 索引定义（schema v6 预留；默认不建表——
/// 决策门显示批量同步成本高，待“扫描后批量重建”优化后再启用）。
/// 未采纳默认启用；测试与未来启用时使用（待批量重建优化）。
#[cfg_attr(not(test), allow(dead_code))]
const FTS_SCHEMA: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    name, path,
    tokenize = 'trigram',
    content='',
    contentless_delete=1
);
"#;

const ARCHIVE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS archive_ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    dest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_archive_ops_batch ON archive_ops(batch_id);
CREATE INDEX IF NOT EXISTS idx_archive_ops_created ON archive_ops(created_at);
CREATE TABLE IF NOT EXISTS shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lnk_path TEXT NOT NULL UNIQUE,
    target_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
"#;

/// 版本化迁移：v1 为初始 schema。后续加表/字段一律在此追加迁移分支。
fn migrate(conn: &mut Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version < 1 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", 1)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 2 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(ARCHIVE_SCHEMA)
            .map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", 2)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 3 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let has_deleted_at = {
            let mut stmt = tx
                .prepare("PRAGMA table_info(files)")
                .map_err(|e| e.to_string())?;
            let names = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?;
            names
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
                .iter()
                .any(|name| name == "deleted_at")
        };
        if !has_deleted_at {
            tx.execute_batch("ALTER TABLE files ADD COLUMN deleted_at INTEGER")
                .map_err(|e| e.to_string())?;
        }
        tx.pragma_update(None, "user_version", 3)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 4 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(INDEX_SCHEMA).map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", 4)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 5 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(USN_STATE_SCHEMA)
            .map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", 5)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 6 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        // FTS 表默认不创建（未采纳），保留版本号占位；启用时在此建表并重建索引。
        tx.pragma_update(None, "user_version", 6)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 7 {
        // 索引维护复核决策：idx_files_type 在类型查询与建库上均无收益（同轮对比两轮一致），移除。
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch("DROP INDEX IF EXISTS idx_files_type")
            .map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", 7)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn row_to_record(row: &Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        id: row.get("id")?,
        path: row.get("path")?,
        name: row.get("name")?,
        size: row.get("size")?,
        file_type: row.get("file_type")?,
        labels: row.get("labels")?,
        first_seen: row.get("first_seen")?,
        modified: row.get("modified")?,
        state: row.get("state")?,
    })
}

/// SQLite 索引库：内部互斥连接 + WAL，单写多读安全。
pub struct SqliteIndexStore {
    conn: Mutex<Connection>,
    /// FTS5 索引是否就绪（表存在且有数据或已写入）；为 false 时文本查询回退 LIKE
    fts_ready: bool,
}

impl SqliteIndexStore {
    /// 打开（或创建）索引库。`path` 为数据库文件路径，`:memory:` 仅用于测试。
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        // 全新用户首次启动时数据目录可能尚不存在，必须显式创建（CI 冒烟曾暴露同类问题）
        if path != Path::new(":memory:") {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        migrate(&mut conn)?;
        conn.pragma_update(None, "journal_size_limit", 64 * 1024 * 1024)
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "wal_autocheckpoint", 1000)
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "mmap_size", 256 * 1024 * 1024)
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "cache_size", -16384)
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let before = now_millis() - 30 * 86_400_000;
        fts_delete_tombstones(&conn, before)?;
        let purged = conn
            .execute(
                "DELETE FROM files WHERE state = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2",
                params![FileState::Deleted.as_str(), before],
            )
            .map_err(|e| e.to_string())?;
        if purged > 0 {
            log::info!("storage: 清理墓碑 count={purged}");
        }
        let fts_ready = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM files_fts)", [], |row| {
                row.get::<_, i64>(0)
            })
            .map(|n| n > 0)
            .unwrap_or(false);
        Ok(Self {
            conn: Mutex::new(conn),
            fts_ready,
        })
    }

    /// 基准专用：打开后移除 idx_files_type，用于“type 索引去留”决策门对比。
    #[cfg(feature = "bench")]
    pub fn open_without_type_index(path: impl AsRef<Path>) -> Result<Self, String> {
        let store = Self::open(path)?;
        store
            .conn
            .lock()
            .map_err(|e| e.to_string())?
            .execute_batch("DROP INDEX IF EXISTS idx_files_type")
            .map_err(|e| e.to_string())?;
        Ok(store)
    }

    /// 物理删除指定时间之前标记为 deleted 的墓碑记录，返回删除条数。
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn purge_tombstones(&self, before_ms: i64) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        fts_delete_tombstones(&conn, before_ms)?;
        let n = conn
            .execute(
                "DELETE FROM files WHERE state = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2",
                params![FileState::Deleted.as_str(), before_ms],
            )
            .map_err(|e| e.to_string())?;
        Ok(n as i64)
    }

    /// WAL checkpoint + `PRAGMA optimize`（退出/空闲维护）。
    pub fn checkpoint_and_optimize(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA optimize;")
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl IndexStore for SqliteIndexStore {
    fn upsert(&mut self, record: &FileRecord) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            INSERT INTO files (path, name, size, file_type, labels, first_seen, modified, state)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                size = excluded.size,
                file_type = excluded.file_type,
                labels = excluded.labels,
                modified = excluded.modified,
                state = excluded.state
            "#,
            params![
                record.path,
                record.name,
                record.size,
                record.file_type,
                record.labels,
                record.first_seen,
                record.modified,
                record.state,
            ],
        )
        .map_err(|e| e.to_string())?;
        sync_fts_for_path(&conn, &record.path)?;
        self.fts_ready = fts_table_exists(&conn);
        Ok(())
    }

    fn get_by_path(&self, path: &str) -> Result<Option<FileRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT * FROM files WHERE path = ?1",
            params![path],
            row_to_record,
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
    }

    fn list(&self, limit: i64, offset: i64) -> Result<Vec<FileRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT * FROM files
                WHERE state != ?1
                ORDER BY modified DESC
                LIMIT ?2 OFFSET ?3
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                params![FileState::Deleted.as_str(), limit, offset],
                row_to_record,
            )
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn all_records(&self) -> Result<Vec<FileRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT * FROM files
                WHERE state != ?1
                ORDER BY id
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![FileState::Deleted.as_str()], row_to_record)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn update_labels(&mut self, path: &str, labels: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE files SET labels = ?1 WHERE path = ?2",
            params![labels, path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn update_labels_batch(&mut self, updates: &[(String, String)]) -> Result<(), String> {
        if updates.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare("UPDATE files SET labels = ?1 WHERE path = ?2")
                .map_err(|e| e.to_string())?;
            for (path, labels) in updates {
                stmt.execute(params![labels, path])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn query(&self, query: &FileQuery) -> Result<QueryPage, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let limit = if query.limit <= 0 {
            200
        } else {
            query.limit.min(1000)
        };
        let offset = query.offset.max(0);

        let mut conditions = vec!["state != ?1".to_string()];
        let mut params: Vec<Value> = Vec::new();
        params.push(Value::Text(FileState::Deleted.as_str().into()));

        if !query.words.is_empty() {
            // FTS5（trigram）：仅当索引就绪且每个词 ≥3 字符时启用，否则回退 LIKE（含 CJK 单/双字）
            let fts_ok = self.fts_ready && query.words.iter().all(|w| w.chars().count() >= 3);
            if fts_ok {
                let match_str = query
                    .words
                    .iter()
                    .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" ");
                conditions.push(format!(
                    "id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?{})",
                    params.len() + 1
                ));
                params.push(Value::Text(match_str));
            } else {
                for word in &query.words {
                    let pattern = format!("%{}%", escape_like(word));
                    conditions.push(format!(
                        "(name LIKE ?{} ESCAPE '\\' OR path LIKE ?{} ESCAPE '\\')",
                        params.len() + 1,
                        params.len() + 2
                    ));
                    params.push(Value::Text(pattern.clone()));
                    params.push(Value::Text(pattern));
                }
            }
        }
        if !query.types.is_empty() {
            let placeholders: Vec<String> = (0..query.types.len())
                .map(|i| format!("?{}", params.len() + i + 1))
                .collect();
            conditions.push(format!("file_type IN ({})", placeholders.join(",")));
            params.extend(query.types.iter().map(|t| Value::Text(t.clone())));
        }
        // 类别以标签形式存于 labels 列（cat: 语义，与 label: 同款匹配方式）
        if !query.categories.is_empty() {
            let ors: Vec<String> = (0..query.categories.len())
                .map(|i| format!("',' || labels || ',' LIKE ?{}", params.len() + i + 1))
                .collect();
            conditions.push(format!("({})", ors.join(" OR ")));
            params.extend(query.categories.iter().map(|t| Value::Text(t.clone())));
        }
        if !query.labels.is_empty() {
            let ors: Vec<String> = (0..query.labels.len())
                .map(|i| format!("',' || labels || ',' LIKE ?{}", params.len() + i + 1))
                .collect();
            conditions.push(format!("({})", ors.join(" OR ")));
            params.extend(
                query
                    .labels
                    .iter()
                    .map(|label| Value::Text(format!("%,{},%", label))),
            );
        }
        for label in &query.labels_all {
            conditions.push(format!("',' || labels || ',' LIKE ?{}", params.len() + 1));
            params.push(Value::Text(format!("%,{label},%")));
        }
        if !query.states.is_empty() {
            let placeholders: Vec<String> = (0..query.states.len())
                .map(|i| format!("?{}", params.len() + i + 1))
                .collect();
            conditions.push(format!("state IN ({})", placeholders.join(",")));
            params.extend(query.states.iter().map(|s| Value::Text(s.clone())));
        }
        if let Some(min) = query.size_min {
            conditions.push(format!("size >= ?{}", params.len() + 1));
            params.push(Value::Integer(min));
        }
        if let Some(max) = query.size_max {
            conditions.push(format!("size <= ?{}", params.len() + 1));
            params.push(Value::Integer(max));
        }
        if let Some(before) = query.before {
            conditions.push(format!("modified <= ?{}", params.len() + 1));
            params.push(Value::Integer(before));
        }
        if let Some(after) = query.after {
            conditions.push(format!("modified >= ?{}", params.len() + 1));
            params.push(Value::Integer(after));
        }

        let where_sql = conditions.join(" AND ");
        let (order_col, order_dir) = sort_clause(query);

        // keyset 游标：提供时忽略 offset；游标值类型必须与排序字段一致
        let mut page_conditions = conditions.clone();
        let mut page_params = params.clone();
        if let Some(cursor) = &query.cursor {
            let (sort_value, cursor_id) = decode_cursor(cursor)?;
            let is_text_col = order_col.contains("COLLATE NOCASE");
            let sort_param = if is_text_col {
                Value::Text(
                    sort_value
                        .as_str()
                        .ok_or_else(|| "无效的游标：排序字段为文本".to_string())?
                        .to_string(),
                )
            } else {
                Value::Integer(
                    sort_value
                        .as_i64()
                        .ok_or_else(|| "无效的游标：排序字段为整数".to_string())?,
                )
            };
            let ph = page_params.len() + 1;
            page_params.push(sort_param);
            page_params.push(Value::Integer(cursor_id));
            let cmp = if order_dir == "ASC" { ">" } else { "<" };
            page_conditions.push(format!(
                "({order_col} {cmp} ?{ph} OR ({order_col} = ?{ph} AND id < ?{}))",
                ph + 1
            ));
        }
        let page_where = page_conditions.join(" AND ");

        let total: i64 = if query.need_total {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM files WHERE {where_sql}"),
                params_from_iter(params.iter()),
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?
        } else {
            -1
        };

        let order_sql = if query.cursor.is_some() {
            format!(
                "ORDER BY {order_col} {order_dir}, id DESC LIMIT ?{}",
                page_params.len() + 1
            )
        } else {
            format!(
                "ORDER BY {order_col} {order_dir}, id DESC LIMIT ?{} OFFSET ?{}",
                page_params.len() + 1,
                page_params.len() + 2
            )
        };
        let mut stmt = conn
            .prepare(&format!(
                "SELECT * FROM files WHERE {page_where} {order_sql}"
            ))
            .map_err(|e| e.to_string())?;
        page_params.push(Value::Integer(limit + 1));
        if query.cursor.is_none() {
            page_params.push(Value::Integer(offset));
        }
        let rows = stmt
            .query_map(params_from_iter(page_params.iter()), row_to_record)
            .map_err(|e| e.to_string())?;
        let mut items = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let has_more = items.len() > limit as usize;
        if has_more {
            items.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            let last = items
                .last()
                .ok_or_else(|| "分页计算失败：空页".to_string())?;
            Some(encode_cursor(sort_value_of(&order_col, last), last.id))
        } else {
            None
        };
        Ok(QueryPage {
            items,
            total,
            next_cursor,
        })
    }

    fn upsert_many(&mut self, records: &[FileRecord]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            // 多行 VALUES 批量写入（子批 1000：8 参数/行 = 8000 变量，低于 SQLite 32766 上限），
            // first_seen 不参与冲突更新以保留首次发现时间。
            const SUB_BATCH: usize = 1000;
            for chunk in records.chunks(SUB_BATCH) {
                let mut sql = String::from(
                    "INSERT INTO files (path, name, size, file_type, labels, first_seen, modified, state) VALUES ",
                );
                let mut values: Vec<Value> = Vec::with_capacity(chunk.len() * 8);
                for (i, record) in chunk.iter().enumerate() {
                    if i > 0 {
                        sql.push(',');
                    }
                    let base = i * 8;
                    sql.push_str(&format!(
                        "(?{},?{},?{},?{},?{},?{},?{},?{})",
                        base + 1,
                        base + 2,
                        base + 3,
                        base + 4,
                        base + 5,
                        base + 6,
                        base + 7,
                        base + 8
                    ));
                    values.push(Value::Text(record.path.clone()));
                    values.push(Value::Text(record.name.clone()));
                    values.push(Value::Integer(record.size));
                    values.push(Value::Text(record.file_type.clone()));
                    values.push(Value::Text(record.labels.clone()));
                    values.push(Value::Integer(record.first_seen));
                    values.push(Value::Integer(record.modified));
                    values.push(Value::Text(record.state.clone()));
                }
                sql.push_str(
                    " ON CONFLICT(path) DO UPDATE SET name=excluded.name, size=excluded.size, \
                     file_type=excluded.file_type, labels=excluded.labels, \
                     modified=excluded.modified, state=excluded.state",
                );
                tx.execute(&sql, params_from_iter(values.iter()))
                    .map_err(|e| e.to_string())?;
            }
            // FTS 表未启用时一次性跳过，避免每条记录重复查询 sqlite_master。
            if fts_table_exists(&tx) {
                for record in records {
                    sync_fts_for_path(&tx, &record.path)?;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.fts_ready = fts_table_exists(&conn);
        Ok(())
    }

    fn paths_with_prefix(&self, dir: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let prefix = format!("{}/%", escape_like(dir));
        let mut stmt = conn
            .prepare(
                r#"
                SELECT path FROM files
                WHERE state != ?1
                  AND (LOWER(path) = LOWER(?2) OR LOWER(path) LIKE LOWER(?3) ESCAPE '\')
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![FileState::Deleted.as_str(), dir, prefix], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn count_under_root(&self, root: &str) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let prefix = format!("{}/%", escape_like(root));
        conn.query_row(
            "SELECT COUNT(*) FROM files \
             WHERE state != ?1 \
               AND (LOWER(path) = LOWER(?2) OR LOWER(path) LIKE LOWER(?3) ESCAPE '\\')",
            params![FileState::Deleted.as_str(), root, prefix],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
    }

    fn mark_missing(&mut self, paths: &[String]) -> Result<i64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut changed = 0_i64;
        for chunk in paths.chunks(500) {
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("?{}", i + 3)).collect();
            let sql = format!(
                "UPDATE files SET state = ?1, deleted_at = ?2 WHERE path IN ({})",
                placeholders.join(",")
            );
            let mut values: Vec<Value> = vec![
                Value::Text(FileState::Deleted.as_str().into()),
                Value::Integer(now_millis()),
            ];
            values.extend(chunk.iter().map(|p| Value::Text(p.clone())));
            changed += tx
                .execute(&sql, params_from_iter(values.iter()))
                .map_err(|e| e.to_string())? as i64;
            for path in chunk {
                fts_delete_by_path(&tx, path)?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }

    fn list_labels(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT DISTINCT labels FROM files WHERE labels != ''")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut labels = BTreeSet::new();
        for row in rows {
            let raw = row.map_err(|e| e.to_string())?;
            for label in raw.split(',') {
                if !label.is_empty() {
                    labels.insert(label.to_string());
                }
            }
        }
        Ok(labels.into_iter().collect())
    }

    fn mark_deleted(&mut self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE files SET state = ?1, deleted_at = ?2 WHERE path = ?3",
            params![FileState::Deleted.as_str(), now_millis(), path],
        )
        .map_err(|e| e.to_string())?;
        fts_delete_by_path(&conn, path)?;
        Ok(())
    }

    fn count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM files WHERE state != ?1",
            params![FileState::Deleted.as_str()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
    }

    fn maintenance(&mut self) -> Result<(), String> {
        self.checkpoint_and_optimize()
    }

    fn get_last_usn(&self, volume: &str) -> Result<Option<i64>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT last_usn FROM usn_state WHERE volume = ?1",
            params![volume],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    fn set_last_usn(&mut self, volume: &str, last_usn: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO usn_state (volume, last_usn, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(volume) DO UPDATE SET last_usn = excluded.last_usn,
                                                updated_at = excluded.updated_at",
            params![volume, last_usn, now_millis()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn move_record(&mut self, from: &str, to: &str, state: &str) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let exists = tx
            .query_row("SELECT 1 FROM files WHERE path = ?1", params![from], |_| {
                Ok(true)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !exists {
            return Err(format!("记录不存在: {from}"));
        }
        let name = Path::new(to)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| to.to_string());
        tx.execute(
            "UPDATE files SET path = ?1, name = ?2, state = ?3 WHERE path = ?4",
            params![to, name, state, from],
        )
        .map_err(|e| e.to_string())?;
        fts_delete_by_path(&tx, from)?;
        sync_fts_for_path(&tx, to)?;
        self.fts_ready = fts_table_exists(&tx);
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn archive_record(&mut self, from: &str, to: &str, op: &ArchiveOp) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let exists = tx
            .query_row("SELECT 1 FROM files WHERE path = ?1", params![from], |_| {
                Ok(true)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !exists {
            return Err(format!("记录不存在: {from}"));
        }
        let name = Path::new(to)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| to.to_string());
        tx.execute(
            "UPDATE files SET path = ?1, name = ?2, state = ?3 WHERE path = ?4",
            params![to, name, FileState::Archived.as_str(), from],
        )
        .map_err(|e| e.to_string())?;
        fts_delete_by_path(&tx, from)?;
        sync_fts_for_path(&tx, to)?;
        tx.execute(
            "INSERT INTO archive_ops (batch_id, kind, source, dest, created_at, undone_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                op.batch_id,
                op.kind,
                op.source,
                op.dest,
                op.created_at,
                op.undone_at
            ],
        )
        .map_err(|e| e.to_string())?;
        self.fts_ready = fts_table_exists(&tx);
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn unarchive_record(&mut self, from: &str, to: &str, op_id: i64) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let record_exists = tx
            .query_row("SELECT 1 FROM files WHERE path = ?1", params![from], |_| {
                Ok(true)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !record_exists {
            return Err(format!("记录不存在: {from}"));
        }
        let op_exists = tx
            .query_row(
                "SELECT 1 FROM archive_ops WHERE id = ?1 AND undone_at IS NULL",
                params![op_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !op_exists {
            return Err(format!("操作不存在或已撤销: {op_id}"));
        }
        let name = Path::new(to)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| to.to_string());
        tx.execute(
            "UPDATE files SET path = ?1, name = ?2, state = ?3 WHERE path = ?4",
            params![to, name, FileState::Indexed.as_str(), from],
        )
        .map_err(|e| e.to_string())?;
        fts_delete_by_path(&tx, from)?;
        sync_fts_for_path(&tx, to)?;
        tx.execute(
            "UPDATE archive_ops SET undone_at = ?1 WHERE id = ?2 AND undone_at IS NULL",
            params![now_millis(), op_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn mark_under_roots_deleted(&mut self, roots: &[String]) -> Result<i64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut changed = 0_i64;
        for root in roots {
            let pattern = format!("{}/%", escape_like(root));
            changed += tx
                .execute(
                    "UPDATE files SET state = ?1, deleted_at = ?2 WHERE state != ?1 AND (LOWER(path) = LOWER(?3) OR path LIKE ?4 ESCAPE '\\')",
                    params![
                        FileState::Deleted.as_str(),
                        now_millis(),
                        root,
                        pattern
                    ],
                )
                .map_err(|e| e.to_string())? as i64;
            fts_delete_under_root(&tx, root)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }

    fn insert_archive_op(&mut self, op: &ArchiveOp) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO archive_ops (batch_id, kind, source, dest, created_at, undone_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                op.batch_id,
                op.kind,
                op.source,
                op.dest,
                op.created_at,
                op.undone_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    fn list_archive_batches(&self, limit: i64) -> Result<Vec<ArchiveBatch>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT batch_id, MIN(kind), COUNT(*), MIN(created_at), \
                 (SELECT dest FROM archive_ops o2 WHERE o2.batch_id = archive_ops.batch_id \
                  ORDER BY o2.id LIMIT 1), \
                 SUM(CASE WHEN undone_at IS NULL THEN 1 ELSE 0 END) \
                 FROM archive_ops GROUP BY batch_id ORDER BY MIN(created_at) DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                let pending: i64 = row.get(5)?;
                Ok(ArchiveBatch {
                    batch_id: row.get(0)?,
                    kind: row.get(1)?,
                    count: row.get(2)?,
                    created_at: row.get(3)?,
                    undone: pending == 0,
                    sample_dest: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn ops_for_batch(&self, batch_id: i64) -> Result<Vec<ArchiveOp>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, batch_id, kind, source, dest, created_at, undone_at \
                 FROM archive_ops WHERE batch_id = ?1 ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![batch_id], |row| {
                Ok(ArchiveOp {
                    id: row.get(0)?,
                    batch_id: row.get(1)?,
                    kind: row.get(2)?,
                    source: row.get(3)?,
                    dest: row.get(4)?,
                    created_at: row.get(5)?,
                    undone_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn mark_ops_undone(&mut self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let placeholders: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 2)).collect();
        let sql = format!(
            "UPDATE archive_ops SET undone_at = ?1 \
             WHERE undone_at IS NULL AND id IN ({})",
            placeholders.join(",")
        );
        let mut values: Vec<Value> = vec![Value::Integer(now_millis())];
        values.extend(ids.iter().map(|id| Value::Integer(*id)));
        conn.execute(&sql, params_from_iter(values.iter()))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn prune_archive_ops(&mut self, keep: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM archive_ops WHERE batch_id NOT IN (\
             SELECT batch_id FROM archive_ops GROUP BY batch_id \
             ORDER BY MIN(created_at) DESC LIMIT ?1)",
            params![keep],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn upsert_shortcut(
        &mut self,
        lnk_path: &str,
        target_path: &str,
        created_at: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO shortcuts (lnk_path, target_path, created_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(lnk_path) DO UPDATE SET target_path = excluded.target_path",
            params![lnk_path, target_path, created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn shortcuts_under(&self, root: &str) -> Result<Vec<ShortcutRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let pattern = format!("{}/%", escape_like(root));
        let mut stmt = conn
            .prepare(
                "SELECT lnk_path, target_path FROM shortcuts \
                 WHERE target_path = ?1 OR target_path LIKE ?2 ESCAPE '\\'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![root, pattern], |row| {
                Ok(ShortcutRecord {
                    lnk_path: row.get(0)?,
                    target_path: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn update_shortcut_target(&mut self, lnk_path: &str, target_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE shortcuts SET target_path = ?1 WHERE lnk_path = ?2",
            params![target_path, lnk_path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl ScanDiffStore for SqliteIndexStore {
    fn begin_scan_diff(&mut self, root: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS scan_snapshot(key TEXT PRIMARY KEY, path TEXT NOT NULL);
             DELETE FROM scan_snapshot;
             CREATE TEMP TABLE IF NOT EXISTS scan_seen(key TEXT PRIMARY KEY);
             DELETE FROM scan_seen;",
        )
        .map_err(|e| e.to_string())?;
        let prefix = format!("{}/%", escape_like(root));
        conn.execute(
            "INSERT INTO scan_snapshot(key, path)
             SELECT LOWER(path), path FROM files
             WHERE state != ?1
               AND (LOWER(path) = LOWER(?2) OR LOWER(path) LIKE LOWER(?3) ESCAPE '\\')",
            params![FileState::Deleted.as_str(), root, prefix],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn mark_scan_seen(&mut self, keys: &[String]) -> Result<(), String> {
        if keys.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare("INSERT OR IGNORE INTO scan_seen(key) VALUES (?1)")
                .map_err(|e| e.to_string())?;
            for key in keys {
                stmt.execute(params![key]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn finish_scan_diff(
        &mut self,
        guard_ratio: f64,
        guard_min: i64,
    ) -> Result<ScanDiffSummary, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let snapshot_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM scan_snapshot", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let guard = ((snapshot_total as f64 * guard_ratio).ceil() as i64).max(guard_min);
        let updated: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scan_snapshot s JOIN scan_seen k ON s.key = k.key",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let missing_total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scan_snapshot s LEFT JOIN scan_seen k ON s.key = k.key \
                 WHERE k.key IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let limit = guard.saturating_add(1);
        let mut stmt = conn
            .prepare(
                "SELECT s.path FROM scan_snapshot s LEFT JOIN scan_seen k ON s.key = k.key \
                 WHERE k.key IS NULL ORDER BY s.rowid LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let missing = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        conn.execute_batch("DELETE FROM scan_snapshot; DELETE FROM scan_seen;")
            .map_err(|e| e.to_string())?;
        Ok(ScanDiffSummary {
            updated: updated as usize,
            snapshot_total: snapshot_total as usize,
            missing,
            missing_total,
            guarded: missing_total > guard,
        })
    }

    fn optimize(&mut self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA optimize;")
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// 转义 LIKE 通配符（`%`、`_` 与转义符自身），使搜索按字面匹配。
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 把单条文件记录同步进 FTS5（同事务内调用；contentless 表需手动增删）。
fn sync_fts_for_path(conn: &Connection, path: &str) -> Result<(), String> {
    if !fts_table_exists(conn) {
        return Ok(());
    }
    let id: i64 = conn
        .query_row(
            "SELECT id FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let name: String = conn
        .query_row("SELECT name FROM files WHERE id = ?1", params![id], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM files_fts WHERE rowid = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO files_fts(rowid, name, path) VALUES (?1, ?2, ?3)",
        params![id, name, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// FTS 表是否存在（未采纳/未启用时所有 FTS 操作自动跳过）。
fn fts_table_exists(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE name = 'files_fts'",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

fn fts_delete_by_path(conn: &Connection, path: &str) -> Result<(), String> {
    if !fts_table_exists(conn) {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM files_fts WHERE rowid = (SELECT id FROM files WHERE path = ?1)",
        params![path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn fts_delete_under_root(conn: &Connection, root: &str) -> Result<(), String> {
    if !fts_table_exists(conn) {
        return Ok(());
    }
    let pattern = format!("{}/%", escape_like(root));
    conn.execute(
        "DELETE FROM files_fts WHERE rowid IN (
            SELECT id FROM files
            WHERE LOWER(path) = LOWER(?1) OR path LIKE ?2 ESCAPE '\\'
         )",
        params![root, pattern],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn fts_delete_tombstones(conn: &Connection, before_ms: i64) -> Result<(), String> {
    if !fts_table_exists(conn) {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM files_fts WHERE rowid IN (
            SELECT id FROM files WHERE state = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2
         )",
        params![FileState::Deleted.as_str(), before_ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 排序白名单映射：字段固定为列表达式，杜绝注入；tie-breaker 恒为 id DESC。
fn sort_clause(query: &FileQuery) -> (String, String) {
    let col = match query.sort_by.as_deref() {
        Some("name") => "name COLLATE NOCASE",
        Some("type") => "file_type COLLATE NOCASE",
        Some("size") => "size",
        Some("modified") => "modified",
        Some("labels") => "labels COLLATE NOCASE",
        _ => "modified",
    };
    let dir = if query.sort_dir.eq_ignore_ascii_case("asc") {
        "ASC"
    } else {
        "DESC"
    };
    (col.to_string(), dir.to_string())
}

/// 从记录提取排序字段值（与 sort_clause 的列表达式一一对应），用于 keyset 游标编码。
fn sort_value_of(order_col: &str, record: &FileRecord) -> serde_json::Value {
    if order_col.starts_with("name") {
        serde_json::Value::String(record.name.clone())
    } else if order_col.starts_with("file_type") {
        serde_json::Value::String(record.file_type.clone())
    } else if order_col.starts_with("labels") {
        serde_json::Value::String(record.labels.clone())
    } else if order_col == "size" {
        serde_json::Value::Number(record.size.into())
    } else {
        serde_json::Value::Number(record.modified.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_db_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("rootup_db_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn store() -> SqliteIndexStore {
        SqliteIndexStore::open(":memory:").expect("内存库打开失败")
    }

    fn record(path: &str, size: i64, modified: i64) -> FileRecord {
        FileRecord::new(path, size, modified, "indexed")
    }

    #[test]
    fn crud_round_trip() {
        let mut s = store();
        assert_eq!(s.count().unwrap(), 0);
        s.upsert(&record("C:/Downloads/a.pdf", 100, 1000)).unwrap();
        assert_eq!(s.count().unwrap(), 1);
        let got = s.get_by_path("C:/Downloads/a.pdf").unwrap().unwrap();
        assert_eq!(got.name, "a.pdf");
        assert_eq!(got.file_type, "pdf");
        assert_eq!(got.state, "indexed");
        assert_eq!(s.get_by_path("C:/none").unwrap(), None);
    }

    #[test]
    fn upsert_is_idempotent_and_keeps_first_seen() {
        let mut s = store();
        let mut r = record("C:/x.txt", 10, 100);
        r.first_seen = 1;
        s.upsert(&r).unwrap();
        let mut updated = record("C:/x.txt", 20, 200);
        updated.first_seen = 999; // 应被忽略，保留原值
        s.upsert(&updated).unwrap();
        let got = s.get_by_path("C:/x.txt").unwrap().unwrap();
        assert_eq!(got.size, 20);
        assert_eq!(got.modified, 200);
        assert_eq!(got.first_seen, 1);
        assert_eq!(s.count().unwrap(), 1);
    }

    #[test]
    fn search_filters_by_name_and_path() {
        let mut s = store();
        s.upsert(&record("C:/Math/notes.pdf", 1, 300)).unwrap();
        s.upsert(&record("C:/Music/song.mp3", 1, 200)).unwrap();
        let r = s.search("notes", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "notes.pdf");
        let r = s.search("music", 10).unwrap();
        assert_eq!(r.len(), 1);
        let r = s.search("nope", 10).unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn list_orders_by_modified_desc_and_paginates() {
        let mut s = store();
        for i in 1..=5 {
            s.upsert(&record(&format!("C:/f{i}.txt"), i, i * 100))
                .unwrap();
        }
        let all = s.list(10, 0).unwrap();
        assert_eq!(all.len(), 5);
        assert_eq!(all[0].name, "f5.txt");
        assert_eq!(all[4].name, "f1.txt");
        let page = s.list(2, 0).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].name, "f5.txt");
    }

    #[test]
    fn mark_deleted_excludes_from_queries() {
        let mut s = store();
        s.upsert(&record("C:/gone.txt", 1, 100)).unwrap();
        s.mark_deleted("C:/gone.txt").unwrap();
        assert_eq!(s.count().unwrap(), 0);
        assert!(s.list(10, 0).unwrap().is_empty());
        assert!(s.search("gone", 10).unwrap().is_empty());
        // 原始记录仍可查（用于路径跟随）
        assert_eq!(
            s.get_by_path("C:/gone.txt").unwrap().unwrap().state,
            "deleted"
        );
    }

    #[test]
    fn purge_tombstones_removes_only_old_deleted() {
        let mut s = store();
        s.upsert(&record("C:/old.txt", 1, 1)).unwrap();
        s.upsert(&record("C:/recent.txt", 1, 1)).unwrap();
        s.mark_deleted("C:/old.txt").unwrap();
        s.mark_deleted("C:/recent.txt").unwrap();
        s.conn
            .lock()
            .unwrap()
            .execute(
                "UPDATE files SET deleted_at = 1 WHERE path = 'C:/old.txt'",
                [],
            )
            .unwrap();
        let removed = s.purge_tombstones(100).unwrap();
        assert_eq!(removed, 1);
        assert!(s.get_by_path("C:/old.txt").unwrap().is_none());
        assert!(s.get_by_path("C:/recent.txt").unwrap().is_some());
    }

    #[test]
    fn all_records_excludes_deleted_and_update_labels_preserves_meta() {
        let mut s = store();
        let mut r = record("C:/Math/高等数学笔记.pdf", 100, 1000);
        r.labels = "document".into();
        s.upsert(&r).unwrap();
        s.upsert(&record("C:/gone.txt", 1, 1)).unwrap();
        s.mark_deleted("C:/gone.txt").unwrap();

        let all = s.all_records().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].labels, "document");

        s.update_labels("C:/Math/高等数学笔记.pdf", "document,course-c-demo-1")
            .unwrap();
        let got = s.get_by_path("C:/Math/高等数学笔记.pdf").unwrap().unwrap();
        assert_eq!(got.labels, "document,course-c-demo-1");
        assert_eq!(got.first_seen, 1000);
        assert_eq!(got.modified, 1000);
    }

    #[test]
    fn label_filter_matches_exact_key_not_prefix() {
        let mut s = store();
        s.upsert(&record_with(
            "C:/a/course-1.pdf",
            1,
            100,
            "pdf",
            "document,course-1",
            "indexed",
        ))
        .unwrap();
        s.upsert(&record_with(
            "C:/b/course-10.pdf",
            1,
            200,
            "pdf",
            "document,course-10",
            "indexed",
        ))
        .unwrap();

        let page = s
            .query(&FileQuery {
                labels: vec!["course-1".into()],
                limit: 10,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1, "course-1 不应误命中 course-10");
        assert_eq!(page.items[0].name, "course-1.pdf");

        let page = s
            .query(&FileQuery {
                labels: vec!["course".into()],
                limit: 10,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 0, "裸 course 不应命中 course-1/course-10");
    }

    #[test]
    fn label_multi_value_or_and_combined_query_bind_correctly() {
        let mut s = store();
        s.upsert(&record_with(
            "C:/a.pdf", 1, 100, "pdf", "document", "indexed",
        ))
        .unwrap();
        s.upsert(&record_with("C:/b.pdf", 2, 200, "pdf", "course", "indexed"))
            .unwrap();
        s.upsert(&record_with(
            "C:/c.pdf",
            3,
            300,
            "pdf",
            "document,course",
            "indexed",
        ))
        .unwrap();
        s.upsert(&record_with("C:/d.txt", 4, 400, "txt", "image", "indexed"))
            .unwrap();

        // Multiple labels are OR within the dimension: any hit is shown.
        let page = s
            .query(&FileQuery {
                labels: vec!["document".into(), "course".into()],
                limit: 10,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 3, "multi-label OR should match a/b/c");

        // Combined dimensions must not collide placeholder indices.
        let page = s
            .query(&FileQuery {
                words: vec!["a".into()],
                labels: vec!["document".into(), "course".into()],
                types: vec!["pdf".into()],
                states: vec!["indexed".into()],
                limit: 10,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1, "combined query should bind and match a.pdf");
        assert_eq!(page.items[0].name, "a.pdf");
    }

    #[test]
    fn query_binding_matrix_covers_label_counts_and_combined_dims() {
        let mut s = store();
        s.upsert(&record_with(
            "C:/a.pdf", 1, 100, "pdf", "document", "indexed",
        ))
        .unwrap();
        s.upsert(&record_with("C:/b.pdf", 2, 200, "pdf", "course", "indexed"))
            .unwrap();
        s.upsert(&record_with(
            "C:/c.txt",
            3,
            300,
            "txt",
            "document,course",
            "indexed",
        ))
        .unwrap();

        let labels = ["document", "course", "image", "code", "audio"];
        for count in 0..=labels.len() {
            for has_words in [false, true] {
                for has_types in [false, true] {
                    for has_states in [false, true] {
                        for has_size in [false, true] {
                            for has_date in [false, true] {
                                for sort_by in [None, Some("name"), Some("size")] {
                                    let mut q = FileQuery {
                                        limit: 10,
                                        ..Default::default()
                                    };
                                    q.labels =
                                        labels[..count].iter().map(|s| s.to_string()).collect();
                                    if has_words {
                                        q.words = vec!["pdf".into()];
                                    }
                                    if has_types {
                                        q.types = vec!["pdf".into()];
                                    }
                                    if has_states {
                                        q.states = vec!["indexed".into()];
                                    }
                                    if has_size {
                                        q.size_min = Some(1);
                                    }
                                    if has_date {
                                        q.before = Some(400);
                                    }
                                    q.sort_by = sort_by.map(|s| s.to_string());

                                    // 任何组合都不允许出现占位符/参数数量错误。
                                    let page =
                                        s.query(&q).expect("query must bind without param errors");
                                    assert!(page.total >= 0);
                                    assert!(page.items.len() <= 10);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn update_labels_batch_updates_all_and_preserves_meta() {
        let mut s = store();
        s.upsert(&record("C:/a.pdf", 1, 100)).unwrap();
        s.upsert(&record("C:/b.pdf", 1, 200)).unwrap();

        s.update_labels_batch(&[
            ("C:/a.pdf".to_string(), "document".to_string()),
            ("C:/b.pdf".to_string(), "image".to_string()),
        ])
        .unwrap();

        let a = s.get_by_path("C:/a.pdf").unwrap().unwrap();
        let b = s.get_by_path("C:/b.pdf").unwrap().unwrap();
        assert_eq!(a.labels, "document");
        assert_eq!(b.labels, "image");
        assert_eq!(a.first_seen, 100);
        assert_eq!(a.modified, 100);
        assert_eq!(b.first_seen, 200);
        assert_eq!(b.modified, 200);
    }

    #[test]
    fn search_escapes_like_wildcards() {
        let mut s = store();
        s.upsert(&record("C:/report100.pdf", 1, 100)).unwrap();
        s.upsert(&record("C:/a_b.txt", 1, 200)).unwrap();
        s.upsert(&record("C:/axb.txt", 1, 300)).unwrap();
        // "100%" 中的 % 是 LIKE 通配符：转义后不应匹配 report100.pdf
        let r = s.search("100%", 10).unwrap();
        assert!(
            r.is_empty(),
            "字面 '100%' 不应匹配 report100.pdf，实际: {:?}",
            r.iter().map(|f| &f.name).collect::<Vec<_>>()
        );
        // "a_b" 中的 _ 是 LIKE 通配符：转义后不应匹配 axb.txt
        let r = s.search("a_b", 10).unwrap();
        assert_eq!(r.len(), 1, "只有 a_b.txt 应命中");
        assert_eq!(r[0].name, "a_b.txt");
    }

    #[test]
    fn real_file_database_round_trip() {
        let dir = temp_db_dir("real");
        let db = dir.join("index.db");
        {
            let mut s = SqliteIndexStore::open(&db).unwrap();
            s.upsert(&record("C:/中文/文件.pdf", 1, 1)).unwrap();
            assert_eq!(s.count().unwrap(), 1);
        }
        // 重复打开幂等（表已存在）
        {
            let s = SqliteIndexStore::open(&db).unwrap();
            assert_eq!(s.count().unwrap(), 1);
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_creates_missing_parent_directory() {
        let dir = std::env::temp_dir().join(format!(
            "rootup_index_missing_parent_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let db = dir.join("nested").join("rootup.db");
        let store = SqliteIndexStore::open(&db).expect("应自动创建父目录并打开");
        drop(store);
        assert!(db.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unicode_path_crud() {
        let mut s = store();
        let path = "C:/课件/高等数学/第1章 极限.pdf";
        s.upsert(&record(path, 100, 1)).unwrap();
        let got = s.get_by_path(path).unwrap().unwrap();
        assert_eq!(got.name, "第1章 极限.pdf");
        assert_eq!(s.search("极限", 10).unwrap().len(), 1);
    }

    #[test]
    fn migrate_v3_to_v7_creates_query_indexes_and_drops_legacy() {
        let dir = temp_db_dir("migrate_v3_v4");
        let db = dir.join("rootup.db");
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    file_type TEXT NOT NULL DEFAULT '',
                    labels TEXT NOT NULL DEFAULT '',
                    first_seen INTEGER NOT NULL,
                    modified INTEGER NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending',
                    deleted_at INTEGER
                 );
                 CREATE INDEX idx_files_name ON files(name COLLATE NOCASE);
                 PRAGMA user_version = 3;",
            )
            .unwrap();
        }
        let store = SqliteIndexStore::open(db.to_str().unwrap()).unwrap();
        let conn = store.conn.lock().unwrap();
        let indexes: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_files_%'",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 7);
        assert!(indexes.contains(&"idx_files_state".to_string()));
        assert!(indexes.contains(&"idx_files_modified".to_string()));
        assert!(!indexes.contains(&"idx_files_type".to_string()));
        assert!(!indexes.contains(&"idx_files_name".to_string()));
        assert!(!indexes.contains(&"idx_files_state_modified".to_string()));
        let usn_tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'usn_state'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(usn_tables, 1);
        // FTS 表默认不创建（决策门未采纳），版本号占位保留
        let fts_tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'files_fts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_tables, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fts_syncs_and_falls_back_for_short_words() {
        let mut s = store();
        // 显式启用 FTS（决策门通过后由迁移创建；此处验证同步与查询路径）
        s.conn.lock().unwrap().execute_batch(FTS_SCHEMA).unwrap();
        let mut r = record("C:/x/高等数学笔记.pdf", 100, 1);
        r.name = "高等数学笔记.pdf".to_string();
        s.upsert(&r).unwrap();

        // ≥3 字词走 FTS
        let page = s
            .query(&FileQuery {
                words: vec!["高等数学".to_string()],
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);

        // 单字回退 LIKE
        let page = s
            .query(&FileQuery {
                words: vec!["高".to_string()],
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);

        // 删除后 FTS 同步清除
        s.mark_deleted("C:/x/高等数学笔记.pdf").unwrap();
        let page = s
            .query(&FileQuery {
                words: vec!["高等数学".to_string()],
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 0);

        // 移动后 FTS 同步到新路径
        s.upsert(&r).unwrap();
        s.move_record(
            "C:/x/高等数学笔记.pdf",
            "C:/arch/高等数学笔记.pdf",
            "archived",
        )
        .unwrap();
        let page = s
            .query(&FileQuery {
                words: vec!["高等数学".to_string()],
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].path, "C:/arch/高等数学笔记.pdf");
    }

    #[test]
    fn usn_state_crud_and_update() {
        let mut s = store();
        assert_eq!(s.get_last_usn("C:").unwrap(), None);
        s.set_last_usn("C:", 100).unwrap();
        assert_eq!(s.get_last_usn("C:").unwrap(), Some(100));
        s.set_last_usn("C:", 200).unwrap();
        assert_eq!(s.get_last_usn("C:").unwrap(), Some(200));
        assert_eq!(s.get_last_usn("D:").unwrap(), None);
    }

    #[test]
    fn escape_like_function() {
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("a\\b"), "a\\\\b");
        assert_eq!(escape_like("plain"), "plain");
    }

    fn record_with(
        path: &str,
        size: i64,
        modified: i64,
        file_type: &str,
        labels: &str,
        state: &str,
    ) -> FileRecord {
        let mut r = record(path, size, modified);
        r.file_type = file_type.to_string();
        r.labels = labels.to_string();
        r.state = state.to_string();
        r
    }

    #[test]
    fn query_filters_by_dimensions() {
        let mut s = store();
        s.upsert(&record_with(
            "C:/math/notes.pdf",
            2 * 1024 * 1024,
            1000,
            "pdf",
            "document,course",
            "indexed",
        ))
        .unwrap();
        s.upsert(&record_with(
            "C:/music/song.mp3",
            5 * 1024 * 1024,
            2000,
            "mp3",
            "audio",
            "indexed",
        ))
        .unwrap();
        s.upsert(&record_with(
            "C:/tmp/pending.bin",
            100,
            3000,
            "bin",
            "",
            "pending",
        ))
        .unwrap();

        let q = |mut query: FileQuery| {
            query.limit = 10;
            query.offset = 0;
            s.query(&query).unwrap()
        };

        let page = q(FileQuery {
            types: vec!["pdf".into()],
            ..Default::default()
        });
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].name, "notes.pdf");

        let page = q(FileQuery {
            labels: vec!["audio".into()],
            ..Default::default()
        });
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].name, "song.mp3");

        let page = q(FileQuery {
            states: vec!["pending".into()],
            ..Default::default()
        });
        assert_eq!(page.total, 1);

        let page = q(FileQuery {
            size_min: Some(1024 * 1024),
            size_max: Some(10 * 1024 * 1024),
            ..Default::default()
        });
        assert_eq!(page.total, 2);

        let page = q(FileQuery {
            before: Some(2500),
            ..Default::default()
        });
        assert_eq!(page.total, 2);

        let page = q(FileQuery {
            after: Some(2500),
            ..Default::default()
        });
        assert_eq!(page.total, 1);
    }

    #[test]
    fn keyset_pagination_matches_offset() {
        let mut store = store();
        for i in 0..37 {
            let r = FileRecord::new(
                &format!("C:/keyset/{i:02}.txt"),
                i * 10,
                1000 + i,
                "indexed",
            );
            store.upsert(&r).unwrap();
        }

        let mut offset_items = Vec::new();
        let mut off = 0;
        loop {
            let page = store
                .query(&FileQuery {
                    limit: 10,
                    offset: off,
                    need_total: true,
                    ..Default::default()
                })
                .unwrap();
            offset_items.extend(page.items.iter().map(|r| r.id));
            if page.items.len() < 10 {
                break;
            }
            off += 10;
        }

        let mut cursor_items = Vec::new();
        let mut cursor = None;
        loop {
            let page = store
                .query(&FileQuery {
                    limit: 10,
                    cursor: cursor.clone(),
                    need_total: false,
                    ..Default::default()
                })
                .unwrap();
            assert_eq!(page.total, -1);
            cursor_items.extend(page.items.iter().map(|r| r.id));
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(offset_items, cursor_items);
        assert_eq!(offset_items.len(), 37);
    }

    #[test]
    fn keyset_cursor_type_mismatch_is_rejected() {
        let mut store = store();
        store
            .upsert(&FileRecord::new("C:/x/a.txt", 1, 1, "indexed"))
            .unwrap();
        let numeric_field_text_cursor = FileQuery {
            cursor: Some(encode_cursor(serde_json::json!("abc"), 1)),
            ..Default::default()
        };
        assert!(store.query(&numeric_field_text_cursor).is_err());
        let text_field_numeric_cursor = FileQuery {
            cursor: Some(encode_cursor(serde_json::json!(5), 1)),
            sort_by: Some("name".to_string()),
            ..Default::default()
        };
        assert!(store.query(&text_field_numeric_cursor).is_err());
    }

    #[test]
    fn need_total_false_returns_minus_one() {
        let mut store = store();
        store
            .upsert(&FileRecord::new("C:/x/a.txt", 1, 1, "indexed"))
            .unwrap();
        let page = store
            .query(&FileQuery {
                need_total: false,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, -1);
        assert_eq!(page.items.len(), 1);
        let page = store
            .query(&FileQuery {
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);
    }

    #[test]
    fn labels_all_requires_every_label() {
        let mut store = store();
        for (path, labels) in [
            ("C:/x/a.txt", "a,b"),
            ("C:/x/b.txt", "a"),
            ("C:/x/c.txt", "b"),
            ("C:/x/d.txt", "c"),
            ("C:/x/e.txt", ""),
        ] {
            let mut r = FileRecord::new(path, 1, 1, "indexed");
            r.labels = labels.to_string();
            store.upsert(&r).unwrap();
        }
        let page = store
            .query(&FileQuery {
                labels_all: vec!["a".to_string(), "b".to_string()],
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].path, "C:/x/a.txt");

        let page = store
            .query(&FileQuery {
                labels: vec!["a".to_string(), "c".to_string()],
                need_total: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 3);
    }

    #[test]
    fn query_combines_text_and_dimensions() {
        let mut s = store();
        s.upsert(&record_with(
            "C:/math/高数笔记.pdf",
            100,
            1000,
            "pdf",
            "document",
            "indexed",
        ))
        .unwrap();
        s.upsert(&record_with(
            "C:/music/notes.mp3",
            100,
            2000,
            "mp3",
            "audio",
            "indexed",
        ))
        .unwrap();
        let page = s
            .query(&FileQuery {
                words: vec!["笔记".into()],
                types: vec!["pdf".into()],
                limit: 10,
                offset: 0,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].name, "高数笔记.pdf");
    }

    #[test]
    fn query_paginates_with_total() {
        let mut s = store();
        for i in 1..=5 {
            s.upsert(&record(&format!("C:/f{i}.txt"), i, i * 100))
                .unwrap();
        }
        let page = s
            .query(&FileQuery {
                limit: 2,
                offset: 2,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 5);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].name, "f3.txt");
    }

    #[test]
    fn paths_with_prefix_includes_subdirs_case_insensitive() {
        let mut s = store();
        s.upsert(&record("C:/Users/X/a.txt", 1, 1)).unwrap();
        s.upsert(&record("C:/Users/X/sub/b.txt", 1, 1)).unwrap();
        s.upsert(&record("C:/Users/X2/c.txt", 1, 1)).unwrap();
        s.upsert(&record("C:/other/d.txt", 1, 1)).unwrap();
        let paths = s.paths_with_prefix("c:/users/x").unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().any(|p| p.ends_with("b.txt")));
        assert!(!paths.iter().any(|p| p.contains("X2")));
    }

    #[test]
    fn mark_missing_batch_marks_deleted() {
        let mut s = store();
        for i in 1..=5 {
            s.upsert(&record(&format!("C:/gone/{i}.txt"), i, i))
                .unwrap();
        }
        let paths: Vec<String> = (1..=5).map(|i| format!("C:/gone/{i}.txt")).collect();
        let changed = s.mark_missing(&paths).unwrap();
        assert_eq!(changed, 5);
        assert_eq!(s.count().unwrap(), 0);
        assert_eq!(
            s.get_by_path("C:/gone/1.txt").unwrap().unwrap().state,
            "deleted"
        );
    }

    #[test]
    fn upsert_many_is_idempotent_and_preserves_first_seen() {
        let mut s = store();
        let mut r1 = record("C:/x/a.txt", 10, 100);
        r1.first_seen = 1;
        let r2 = record("C:/x/b.txt", 20, 200);
        s.upsert_many(&[r1.clone(), r2]).unwrap();
        assert_eq!(s.count().unwrap(), 2);
        let mut updated = record("C:/x/a.txt", 30, 300);
        updated.first_seen = 999;
        s.upsert_many(&[updated]).unwrap();
        assert_eq!(s.count().unwrap(), 2);
        let got = s.get_by_path("C:/x/a.txt").unwrap().unwrap();
        assert_eq!(got.size, 30);
        assert_eq!(got.first_seen, 1);
    }

    #[test]
    fn list_labels_collects_and_sorts() {
        let mut s = store();
        s.upsert(&record_with(
            "C:/a.pdf",
            1,
            1,
            "pdf",
            "document,course",
            "indexed",
        ))
        .unwrap();
        s.upsert(&record_with("C:/b.mp3", 1, 2, "mp3", "audio", "indexed"))
            .unwrap();
        s.upsert(&record_with("C:/c.txt", 1, 3, "txt", "document", "pending"))
            .unwrap();
        let labels = s.list_labels().unwrap();
        assert_eq!(labels, vec!["audio", "course", "document"]);
    }

    #[test]
    fn migration_sets_user_version_once() {
        let dir = temp_db_dir("migrate");
        let db = dir.join("migrate.db");
        {
            let s = SqliteIndexStore::open(&db).unwrap();
            let conn = s.conn.lock().unwrap();
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, 7);
        }
        // 重复打开幂等，不报错
        {
            let s = SqliteIndexStore::open(&db).unwrap();
            let conn = s.conn.lock().unwrap();
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, 7);
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn move_record_updates_path_and_state() {
        let mut s = store();
        s.upsert(&record("C:/Downloads/a.pdf", 100, 1000)).unwrap();
        s.move_record(
            "C:/Downloads/a.pdf",
            "C:/Archive/document/a.pdf",
            "archived",
        )
        .unwrap();
        assert!(s.get_by_path("C:/Downloads/a.pdf").unwrap().is_none());
        let moved = s.get_by_path("C:/Archive/document/a.pdf").unwrap().unwrap();
        assert_eq!(moved.state, "archived");
        assert_eq!(moved.name, "a.pdf");
        assert!(s.move_record("C:/none", "C:/x", "indexed").is_err());
    }

    #[test]
    fn mark_under_roots_deleted_is_idempotent() {
        let mut s = store();
        s.upsert(&record("C:/Watch/proj/src/main.rs", 1, 1))
            .unwrap();
        s.upsert(&record("C:/Watch/doc/note.md", 1, 1)).unwrap();
        s.upsert(&record("C:/Archive/doc/a.pdf", 1, 1)).unwrap();
        let roots = vec!["C:/Watch/proj".to_string(), "C:/Archive".to_string()];
        let first = s.mark_under_roots_deleted(&roots).unwrap();
        assert_eq!(first, 2);
        let second = s.mark_under_roots_deleted(&roots).unwrap();
        assert_eq!(second, 0);
        assert_eq!(
            s.get_by_path("C:/Watch/proj/src/main.rs")
                .unwrap()
                .unwrap()
                .state,
            "deleted"
        );
        assert_eq!(
            s.get_by_path("C:/Watch/doc/note.md")
                .unwrap()
                .unwrap()
                .state,
            "indexed"
        );
    }

    #[test]
    fn count_under_root_counts_non_deleted_subtree() {
        let mut s = store();
        s.upsert(&record("C:/Watch/a.pdf", 1, 1)).unwrap();
        s.upsert(&record("C:/Watch/sub/b.txt", 1, 2)).unwrap();
        s.upsert(&record("C:/Other/c.txt", 1, 3)).unwrap();
        s.upsert(&record("C:/Watch/gone.pdf", 1, 4)).unwrap();
        s.mark_deleted("C:/Watch/gone.pdf").unwrap();

        assert_eq!(s.count_under_root("C:/Watch").unwrap(), 2);
        assert_eq!(s.count_under_root("c:/watch").unwrap(), 2);
        assert_eq!(s.count_under_root("C:/Other").unwrap(), 1);
        assert_eq!(s.count_under_root("C:/None").unwrap(), 0);
    }

    #[test]
    fn archive_ops_roundtrip_and_prune() {
        let mut s = store();
        let op1 = ArchiveOp {
            id: 0,
            batch_id: 100,
            kind: "file".into(),
            source: "C:/a.pdf".into(),
            dest: "C:/Archive/doc/a.pdf".into(),
            created_at: 1,
            undone_at: None,
        };
        let op2 = ArchiveOp {
            id: 0,
            batch_id: 100,
            kind: "file".into(),
            source: "C:/b.pdf".into(),
            dest: "C:/Archive/doc/b.pdf".into(),
            created_at: 2,
            undone_at: None,
        };
        let op3 = ArchiveOp {
            id: 0,
            batch_id: 200,
            kind: "project".into(),
            source: "C:/proj".into(),
            dest: "C:/Archive/项目/proj".into(),
            created_at: 3,
            undone_at: None,
        };
        s.insert_archive_op(&op1).unwrap();
        s.insert_archive_op(&op2).unwrap();
        s.insert_archive_op(&op3).unwrap();

        let batches = s.list_archive_batches(10).unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].batch_id, 200);
        assert!(!batches[0].undone);
        assert_eq!(batches[0].count, 1);
        assert_eq!(batches[1].count, 2);

        let ops = s.ops_for_batch(100).unwrap();
        assert_eq!(ops.len(), 2);
        let ids: Vec<i64> = ops.iter().map(|o| o.id).collect();
        s.mark_ops_undone(&ids).unwrap();
        let after = s.list_archive_batches(10).unwrap();
        assert!(after.iter().find(|b| b.batch_id == 100).unwrap().undone);

        s.prune_archive_ops(1).unwrap();
        let remaining = s.list_archive_batches(10).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].batch_id, 200);
    }

    #[test]
    fn shortcut_registry_roundtrip() {
        let mut s = store();
        s.upsert_shortcut("C:/Desktop/proj.lnk", "C:/proj", 1)
            .unwrap();
        s.upsert_shortcut("C:/Desktop/proj.lnk", "C:/Archive/项目/proj", 2)
            .unwrap();
        let links = s.shortcuts_under("C:/proj").unwrap();
        assert!(links.is_empty());
        let links = s.shortcuts_under("C:/Archive/项目").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].lnk_path, "C:/Desktop/proj.lnk");
        s.update_shortcut_target("C:/Desktop/proj.lnk", "C:/proj")
            .unwrap();
        assert_eq!(s.shortcuts_under("C:/proj").unwrap().len(), 1);
    }

    #[test]
    fn scan_diff_session_computes_updated_and_missing() {
        let mut s = store();
        s.upsert(&record("C:/Watch/keep.txt", 1, 1)).unwrap();
        s.upsert(&record("C:/Watch/gone.txt", 1, 1)).unwrap();
        let mut deleted = record("C:/Watch/old.txt", 1, 1);
        deleted.state = "deleted".into();
        s.upsert(&deleted).unwrap();

        s.begin_scan_diff("C:/Watch").unwrap();
        s.mark_scan_seen(&["c:/watch/keep.txt".into()]).unwrap();
        let summary = s.finish_scan_diff(0.25, 2).unwrap();
        assert_eq!(summary.snapshot_total, 2);
        assert_eq!(summary.updated, 1);
        assert_eq!(summary.missing_total, 1);
        assert_eq!(summary.missing, vec!["C:/Watch/gone.txt"]);
        assert!(!summary.guarded);
    }

    #[test]
    fn scan_diff_guard_and_session_reuse() {
        let mut s = store();
        for i in 0..10 {
            s.upsert(&record(&format!("C:/Watch/g{i}.txt"), 1, 1))
                .unwrap();
        }
        s.begin_scan_diff("C:/Watch").unwrap();
        let summary = s.finish_scan_diff(0.25, 2).unwrap();
        assert!(summary.guarded);
        assert!(summary.missing.len() <= 4, "missing 最多 guard+1");
        assert_eq!(summary.missing_total, 10);

        // 会话结束已清理，可复用同一存储实例
        s.begin_scan_diff("C:/Watch").unwrap();
        let keys: Vec<String> = (0..10).map(|i| format!("c:/watch/g{i}.txt")).collect();
        s.mark_scan_seen(&keys).unwrap();
        let summary = s.finish_scan_diff(0.25, 2).unwrap();
        assert_eq!(summary.updated, 10);
        assert_eq!(summary.missing_total, 0);
        assert!(!summary.guarded);
    }

    #[test]
    fn query_sorts_by_whitelisted_fields() {
        let mut s = store();
        s.upsert(&record("C:/b.txt", 2, 2)).unwrap();
        s.upsert(&record("C:/a.pdf", 1, 3)).unwrap();
        s.upsert(&record("C:/A.txt", 3, 1)).unwrap();
        let page = |field: &str, dir: &str| {
            s.query(&FileQuery {
                sort_by: Some(field.into()),
                sort_dir: dir.into(),
                limit: 10,
                ..Default::default()
            })
            .unwrap()
        };

        let names: Vec<String> = page("name", "asc")
            .items
            .iter()
            .map(|r| r.name.clone())
            .collect();
        assert_eq!(names, vec!["a.pdf", "A.txt", "b.txt"]);

        let sizes: Vec<i64> = page("size", "asc").items.iter().map(|r| r.size).collect();
        assert_eq!(sizes, vec![1, 2, 3]);

        let mods: Vec<i64> = page("modified", "desc")
            .items
            .iter()
            .map(|r| r.modified)
            .collect();
        assert_eq!(mods, vec![3, 2, 1]);

        // 未知字段回退默认排序且不注入 SQL
        let fallback = page("name; DROP TABLE files", "desc");
        assert_eq!(fallback.total, 3);
    }
}
