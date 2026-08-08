# 标签过滤与文本查询实现评估（0.8.5 决策记录）

> 日期：2026-08-08；基准：`engine_query_label_like_ms` / `engine_query_label_json_ms` / `engine_query_text_like_ms` / `engine_query_text_fts_ms`（10 万行内存表，样本 3）。

## 结论

- **标签过滤：保持逗号串 + LIKE，不迁表。** 实测 `',' || labels || ',' LIKE '%,x,%'` 约 9.8ms，`json_each` 约 19.4ms（约慢一倍）。逗号串方案零迁移成本且更快，维持现状。
- **文本查询：FTS5 trigram 有约 2 倍收益（3.3ms vs 6.7ms），列为 0.8.6 候选。** 采纳前提：FTS5 附属表与 files 主表的同步/重建/一致性设计（含归档、重命名、批量 upsert 联动），以及 CJK 单字查询回退 LIKE 的边界；0.8.5 不引入以控制风险。

## 实测数据（p50）

| 指标 | 0.8.5 |
| --- | --- |
| 标签逗号串 LIKE | 9.85 ms |
| 标签 json_each | 19.41 ms |
| 文本 LIKE（CJK） | 6.73 ms |
| 文本 FTS5 trigram | 3.28 ms |

## 与主查询的关系

主查询 `engine_query_text_ms` / `engine_query_label_ms` 在本版本已借助 `idx_files_modified`（排序 + LIMIT 提前终止）与 `idx_files_state`（COUNT 范围扫描）获得 70%+ 提升；本评估解决的是“是否需要进一步换数据结构”的问题，结论为标签不换、文本延后。
