.mode list
.headers off

.print [integrity_check]
PRAGMA integrity_check;
.print [foreign_key_check]
PRAGMA foreign_key_check;
.print [user_version]
PRAGMA user_version;
.print [journal_mode]
PRAGMA journal_mode;

.print [stats]
SELECT 'tables=' || IFNULL(group_concat(name, ','), '') FROM sqlite_master WHERE type = 'table';
SELECT 'total_files=' || COUNT(*) FROM files;
SELECT 'deleted_tombstones=' || COUNT(*) FROM files WHERE state = 'deleted' AND deleted_at IS NOT NULL;
SELECT 'tombstones_over_30d=' || COUNT(*) FROM files
  WHERE state = 'deleted' AND deleted_at IS NOT NULL
    AND deleted_at <= (strftime('%s', 'now') * 1000 - 30 * 86400000);
SELECT 'duplicate_path_keys=' || COUNT(*) FROM (
  SELECT lower(path) AS pk FROM files GROUP BY pk HAVING COUNT(*) > 1
);
SELECT 'malformed_labels=' || COUNT(*) FROM files
  WHERE labels != ''
    AND (labels LIKE ',%' OR labels LIKE '%,' OR labels LIKE '%,,%');
SELECT 'files_by_state=' || state || ':' || COUNT(*) FROM files GROUP BY state;

SELECT 'archive_ops_total=' || COUNT(*) FROM archive_ops;
SELECT 'archive_batches=' || COUNT(DISTINCT batch_id) FROM archive_ops;
SELECT 'archive_ops_undone=' || COUNT(*) FROM archive_ops WHERE undone_at IS NOT NULL;
SELECT 'archive_pending_without_source=' || COUNT(*) FROM archive_ops
  WHERE undone_at IS NULL AND source = '';

SELECT 'shortcuts_total=' || COUNT(*) FROM shortcuts;
SELECT 'shortcuts_duplicate_target=' || COUNT(*) FROM (
  SELECT target_path FROM shortcuts GROUP BY target_path HAVING COUNT(*) > 1
);
