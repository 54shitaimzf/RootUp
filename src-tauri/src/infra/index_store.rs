//! 文件索引的 SQLite 实现。

use crate::core::events::FileState;
use crate::core::index::{FileRecord, IndexStore};
use crate::core::query::{FileQuery, QueryPage};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};
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
    state TEXT NOT NULL DEFAULT 'pending'
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
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
        if !query.types.is_empty() {
            let placeholders: Vec<String> = (0..query.types.len())
                .map(|i| format!("?{}", params.len() + i + 1))
                .collect();
            conditions.push(format!("file_type IN ({})", placeholders.join(",")));
            params.extend(query.types.iter().map(|t| Value::Text(t.clone())));
        }
        if !query.labels.is_empty() {
            let ors: Vec<String> = query
                .labels
                .iter()
                .map(|_label| format!("',' || labels || ',' LIKE ?{}", params.len() + 1))
                .collect();
            conditions.push(format!("({})", ors.join(" OR ")));
            params.extend(
                query
                    .labels
                    .iter()
                    .map(|label| Value::Text(format!("%,{}%", label))),
            );
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
        let total: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM files WHERE {where_sql}"),
                params_from_iter(params.iter()),
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(&format!(
                "SELECT * FROM files WHERE {where_sql} \
                 ORDER BY modified DESC, id DESC LIMIT ?{} OFFSET ?{}",
                params.len() + 1,
                params.len() + 2
            ))
            .map_err(|e| e.to_string())?;
        params.push(Value::Integer(limit));
        params.push(Value::Integer(offset));
        let rows = stmt
            .query_map(params_from_iter(params.iter()), row_to_record)
            .map_err(|e| e.to_string())?;
        let items = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(QueryPage { items, total })
    }

    fn upsert_many(&mut self, records: &[FileRecord]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
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
                )
                .map_err(|e| e.to_string())?;
            for record in records {
                stmt.execute(params![
                    record.path,
                    record.name,
                    record.size,
                    record.file_type,
                    record.labels,
                    record.first_seen,
                    record.modified,
                    record.state,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
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

    fn mark_missing(&mut self, paths: &[String]) -> Result<i64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut changed = 0_i64;
        for chunk in paths.chunks(500) {
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("?{}", i + 2)).collect();
            let sql = format!(
                "UPDATE files SET state = ?1 WHERE path IN ({})",
                placeholders.join(",")
            );
            let mut values: Vec<Value> = vec![Value::Text(FileState::Deleted.as_str().into())];
            values.extend(chunk.iter().map(|p| Value::Text(p.clone())));
            changed += tx
                .execute(&sql, params_from_iter(values.iter()))
                .map_err(|e| e.to_string())? as i64;
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
            "UPDATE files SET state = ?1 WHERE path = ?2",
            params![FileState::Deleted.as_str(), path],
        )
        .map_err(|e| e.to_string())?;
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
}

/// 转义 LIKE 通配符（`%`、`_` 与转义符自身），使搜索按字面匹配。
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
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
            assert_eq!(version, 1);
        }
        // 重复打开幂等，不报错
        {
            let s = SqliteIndexStore::open(&db).unwrap();
            let conn = s.conn.lock().unwrap();
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, 1);
        }
        fs::remove_dir_all(&dir).unwrap();
    }
}
