//! 文件索引的 SQLite 实现。

use crate::core::index::{FileRecord, IndexStore};
use rusqlite::{params, Connection, Row};
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
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
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
                WHERE state != 'deleted'
                ORDER BY modified DESC
                LIMIT ?1 OFFSET ?2
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit, offset], row_to_record)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn search(&self, query: &str, limit: i64) -> Result<Vec<FileRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let pattern = format!("%{}%", escape_like(query));
        let mut stmt = conn
            .prepare(
                r#"
                SELECT * FROM files
                WHERE state != 'deleted'
                  AND (name LIKE ?1 ESCAPE '\' OR path LIKE ?1 ESCAPE '\')
                ORDER BY modified DESC
                LIMIT ?2
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pattern, limit], row_to_record)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn mark_deleted(&mut self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE files SET state = 'deleted' WHERE path = ?1",
            params![path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM files WHERE state != 'deleted'",
            [],
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
}
