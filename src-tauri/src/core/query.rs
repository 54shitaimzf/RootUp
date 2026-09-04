//! 索引搜索语法：解析 `cat:` / `type:` / `label:` / `state:` / `size:` / `before:` / `after:` 与普通文本。
//!
//! 语义约定（真源为本解析器，`fixtures/query-grammar-cases.json` 双端锁用例）：
//! - `cat:` / `category:` 类别筛选，值为 `Category::ALL` 的 key（类别以标签形式存于 labels 列）；
//! - `type:` 精确扩展名匹配（小写），与类别无关——禁止把类别 key 塞进 `type:`
//!   （历史 bug：chips 产出 `type:document` 导致分类筛选永远 0 结果）。
use crate::core::classify::Category;
use crate::core::events::FileState;
use crate::core::index::FileRecord;
use chrono::TimeZone;
use serde::Serialize;

/// 结构化查询：同维度多值 OR，跨维度与文本 token AND。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
    /// 普通文本 token（按 name/path LIKE 匹配，多个 token 全部命中）
    pub words: Vec<String>,
    /// `cat:` / `category:` 类别 key（小写，∈ Category::ALL；以标签形式存于 labels 列）
    pub categories: Vec<String>,
    /// `type:` 精确扩展名（小写）
    pub types: Vec<String>,
    /// `label:` / `tag:` 标签 key
    pub labels: Vec<String>,
    /// 显式 AND 标签组：`+label:` 与 `label:a AND label:b` 语法；与 labels（OR）同时满足
    pub labels_all: Vec<String>,
    /// `state:` / `status:` 状态
    pub states: Vec<String>,
    pub size_min: Option<i64>,
    pub size_max: Option<i64>,
    /// modified <= before（毫秒）
    pub before: Option<i64>,
    /// modified >= after（毫秒）
    pub after: Option<i64>,
    /// 排序字段白名单：name / type / size / modified / labels；None 保持默认（modified DESC）。
    pub sort_by: Option<String>,
    /// 排序方向：asc / desc（默认 desc）。
    pub sort_dir: String,
    /// keyset 分页游标（不透明字符串，由 query 结果回传）；提供时忽略 offset
    pub cursor: Option<String>,
    /// 是否需要精确总数；false 时 total 返回 -1（COUNT 治理）
    pub need_total: bool,
    pub limit: i64,
    pub offset: i64,
}

impl Default for FileQuery {
    fn default() -> Self {
        Self {
            words: Vec::new(),
            categories: Vec::new(),
            types: Vec::new(),
            labels: Vec::new(),
            labels_all: Vec::new(),
            states: Vec::new(),
            size_min: None,
            size_max: None,
            before: None,
            after: None,
            sort_by: None,
            sort_dir: "desc".to_string(),
            cursor: None,
            need_total: true,
            limit: 0,
            offset: 0,
        }
    }
}

/// 查询结果页：记录与总数（分页用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPage {
    pub items: Vec<FileRecord>,
    pub total: i64,
    /// 下一页游标；无更多数据时为 None
    pub next_cursor: Option<String>,
}

/// 解析搜索字符串为结构化查询；非法值与未知前缀回落为普通文本。
pub fn parse_query(input: &str) -> FileQuery {
    let mut query = FileQuery::default();
    let tokens: Vec<&str> = input.split_whitespace().collect();
    let is_label = |token: &str| {
        token.starts_with("label:") || token.starts_with("tag:") || token.starts_with("+label:")
    };
    // AND 判定：`label:a AND label:b`（两侧均为标签 token）或 `+label:` 前缀
    let mut and_required = vec![false; tokens.len()];
    for (i, token) in tokens.iter().enumerate() {
        if !is_label(token) {
            continue;
        }
        let plus = token.starts_with("+label:");
        let next_and = i + 1 < tokens.len()
            && tokens[i + 1].eq_ignore_ascii_case("and")
            && i + 2 < tokens.len()
            && is_label(tokens[i + 2]);
        let prev_and =
            i >= 2 && tokens[i - 1].eq_ignore_ascii_case("and") && is_label(tokens[i - 2]);
        and_required[i] = plus || next_and || prev_and;
    }

    for (i, token) in tokens.iter().enumerate() {
        if let Some(value) = token.strip_prefix("+label:") {
            push_non_empty(&mut query.labels_all, value);
        } else if let Some(value) = token.strip_prefix("category:") {
            push_category(&mut query, value);
        } else if let Some(value) = token.strip_prefix("cat:") {
            push_category(&mut query, value);
        } else if let Some(value) = token.strip_prefix("type:") {
            push_non_empty(&mut query.types, &value.to_ascii_lowercase());
        } else if let Some(value) = token.strip_prefix("label:") {
            if and_required[i] {
                push_non_empty(&mut query.labels_all, value);
            } else {
                push_non_empty(&mut query.labels, value);
            }
        } else if let Some(value) = token.strip_prefix("tag:") {
            if and_required[i] {
                push_non_empty(&mut query.labels_all, value);
            } else {
                push_non_empty(&mut query.labels, value);
            }
        } else if let Some(value) = token.strip_prefix("state:") {
            push_state(&mut query, value);
        } else if let Some(value) = token.strip_prefix("status:") {
            push_state(&mut query, value);
        } else if token.eq_ignore_ascii_case("and") {
            // 合法 AND 已被标签 token 消费；孤立 AND 回落普通文本
            let prev_label = i >= 1 && is_label(tokens[i - 1]);
            let next_label = i + 1 < tokens.len() && is_label(tokens[i + 1]);
            if !(prev_label && next_label) {
                query.words.push(token.to_string());
            }
        } else if let Some(value) = token.strip_prefix("size:") {
            if !apply_size(value, &mut query) {
                query.words.push(token.to_string());
            }
        } else if let Some(value) = token.strip_prefix("before:") {
            match parse_time(value, true) {
                Some(ms) => query.before = Some(ms),
                None => query.words.push(token.to_string()),
            }
        } else if let Some(value) = token.strip_prefix("after:") {
            match parse_time(value, false) {
                Some(ms) => query.after = Some(ms),
                None => query.words.push(token.to_string()),
            }
        } else {
            query.words.push(token.to_string());
        }
    }
    query
}

/// keyset 游标编码：`[排序值, id]`，排序值类型与排序字段一致（文本/整数）。
pub fn encode_cursor(sort_value: serde_json::Value, id: i64) -> String {
    serde_json::json!([sort_value, id]).to_string()
}

/// keyset 游标解码；非法游标返回错误（调用方拒绝查询）。
pub fn decode_cursor(cursor: &str) -> Result<(serde_json::Value, i64), String> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(cursor).map_err(|e| format!("无效的游标: {e}"))?;
    if arr.len() != 2 {
        return Err("无效的游标".into());
    }
    let id = arr[1].as_i64().ok_or_else(|| "无效的游标".to_string())?;
    Ok((arr[0].clone(), id))
}

fn push_non_empty(target: &mut Vec<String>, value: &str) {
    if !value.is_empty() && !target.iter().any(|v| v == value) {
        target.push(value.to_string());
    }
}

fn push_state(query: &mut FileQuery, value: &str) {
    let lower = value.to_ascii_lowercase();
    if FileState::from_str(&lower).is_some() {
        push_non_empty(&mut query.states, &lower);
    } else {
        query.words.push(format!("state:{value}"));
    }
}

/// 类别 token：合法 key 进 categories，未知值回落普通文本（与 state: 语义一致）。
fn push_category(query: &mut FileQuery, value: &str) {
    let lower = value.to_ascii_lowercase();
    if Category::ALL.iter().any(|c| c.key() == lower) {
        push_non_empty(&mut query.categories, &lower);
    } else {
        query.words.push(format!("cat:{value}"));
    }
}

/// 解析 `>N` / `<N` / `N~M` / `N`（支持 B/KB/MB/GB 后缀，大小写不敏感）。
fn apply_size(value: &str, query: &mut FileQuery) -> bool {
    let Some((min, max)) = parse_size_token(value) else {
        return false;
    };
    query.size_min = merge_bound(query.size_min, min, true);
    query.size_max = merge_bound(query.size_max, max, false);
    true
}

fn merge_bound(current: Option<i64>, incoming: Option<i64>, take_max: bool) -> Option<i64> {
    match (current, incoming) {
        (Some(a), Some(b)) => Some(if take_max { a.max(b) } else { a.min(b) }),
        (a, b) => a.or(b),
    }
}

fn parse_size_token(value: &str) -> Option<(Option<i64>, Option<i64>)> {
    let (op, rest) = if let Some(v) = value.strip_prefix('>') {
        (0, v)
    } else if let Some(v) = value.strip_prefix('<') {
        (1, v)
    } else {
        (2, value)
    };
    if rest.is_empty() {
        return None;
    }
    if let Some((a, b)) = rest.split_once('~') {
        let lo = parse_size_value(a)?;
        let hi = parse_size_value(b)?;
        if lo > hi {
            return None;
        }
        return Some((Some(lo), Some(hi)));
    }
    let n = parse_size_value(rest)?;
    match op {
        0 => Some((Some(n), None)),
        1 => Some((None, Some(n))),
        _ => Some((Some(n), Some(n))),
    }
}

fn parse_size_value(value: &str) -> Option<i64> {
    let lower = value.trim().to_ascii_lowercase();
    let (num_part, multiplier) = if let Some(n) = lower.strip_suffix("gb") {
        (n, 1024_i64.pow(3))
    } else if let Some(n) = lower.strip_suffix("mb") {
        (n, 1024_i64.pow(2))
    } else if let Some(n) = lower.strip_suffix("kb") {
        (n, 1024)
    } else if let Some(n) = lower.strip_suffix('b') {
        (n, 1)
    } else {
        (lower.as_str(), 1)
    };
    let number: f64 = num_part.trim().parse().ok()?;
    if number < 0.0 {
        return None;
    }
    Some((number * multiplier as f64).round() as i64)
}

/// 解析毫秒时间戳或 `YYYY-MM-DD`（本地时区，before 含当天、after 含当天起）。
fn parse_time(value: &str, end_of_day: bool) -> Option<i64> {
    if value.len() >= 10 && value.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(ms) = value.parse::<i64>() {
            return Some(ms);
        }
    }
    let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    let naive = if end_of_day {
        date.and_hms_opt(23, 59, 59)?
    } else {
        date.and_hms_opt(0, 0, 0)?
    };
    let local = chrono::Local.from_local_datetime(&naive).earliest()?;
    Some(local.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grammar_fixture_cases() {
        let raw = include_str!("../../../fixtures/query-grammar-cases.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/query-grammar-cases.json 应可解析");
        for case in value["cases"].as_array().expect("cases 应为数组") {
            let input = case["input"].as_str().expect("用例缺 input");
            let q = parse_query(input);
            let encoded = serde_json::to_value(&q).expect("FileQuery 应可序列化");
            for (key, expected) in case.as_object().unwrap() {
                if key == "input" {
                    continue;
                }
                assert_eq!(
                    encoded.get(key),
                    Some(expected),
                    "用例 {input:?} 字段 {key} 与契约不符"
                );
            }
        }
    }

    #[test]
    fn empty_input_is_default() {
        let q = parse_query("");
        assert!(q.words.is_empty() && q.types.is_empty());
        assert_eq!(q.limit, 0);
    }

    #[test]
    fn plain_text_tokens_are_kept_in_order() {
        let q = parse_query("高数 笔记");
        assert_eq!(q.words, vec!["高数".to_string(), "笔记".to_string()]);
    }

    #[test]
    fn type_and_text_combine() {
        let q = parse_query("高数 type:pdf");
        assert_eq!(q.words, vec!["高数".to_string()]);
        assert_eq!(q.types, vec!["pdf".to_string()]);
    }

    #[test]
    fn same_dimension_multi_values_are_or() {
        let q = parse_query("type:pdf type:docx type:PDF");
        assert_eq!(q.types, vec!["pdf".to_string(), "docx".to_string()]);
    }

    #[test]
    fn label_and_tag_aliases() {
        let q = parse_query("label:document tag:course");
        assert_eq!(q.labels, vec!["document".to_string(), "course".to_string()]);
    }

    #[test]
    fn state_accepts_aliases_and_valid_values() {
        let q = parse_query("state:pending status:indexed");
        assert_eq!(q.states, vec!["pending".to_string(), "indexed".to_string()]);
        let q = parse_query("state:unknown");
        assert!(q.states.is_empty());
        assert_eq!(q.words, vec!["state:unknown".to_string()]);
    }

    #[test]
    fn size_tokens_with_units() {
        let q = parse_query("size:>10MB size:<1GB");
        assert_eq!(q.size_min, Some(10 * 1024 * 1024));
        assert_eq!(q.size_max, Some(1024 * 1024 * 1024));

        let q = parse_query("size:5MB~20MB");
        assert_eq!(q.size_min, Some(5 * 1024 * 1024));
        assert_eq!(q.size_max, Some(20 * 1024 * 1024));

        let q = parse_query("size:1024");
        assert_eq!(q.size_min, Some(1024));
        assert_eq!(q.size_max, Some(1024));

        let q = parse_query("size:1.5KB");
        assert_eq!(q.size_min, Some(1536));
    }

    #[test]
    fn single_size_bound_keeps_other_none() {
        let q = parse_query("size:>10MB");
        assert_eq!(q.size_min, Some(10 * 1024 * 1024));
        assert_eq!(q.size_max, None);
        let q = parse_query("size:<1GB");
        assert_eq!(q.size_min, None);
        assert_eq!(q.size_max, Some(1024 * 1024 * 1024));
    }

    #[test]
    fn invalid_size_falls_back_to_text() {
        let q = parse_query("size:>abc");
        assert_eq!(q.words, vec!["size:>abc".to_string()]);
        assert_eq!(q.size_min, None);
    }

    #[test]
    fn date_tokens_parse_to_local_millis() {
        let q = parse_query("after:2026-08-01");
        assert!(q.after.is_some());
        let q = parse_query("before:2026-08-01");
        assert!(q.before.is_some());
        // 毫秒时间戳
        let q = parse_query("before:1700000000000");
        assert_eq!(q.before, Some(1700000000000));
    }

    #[test]
    fn invalid_date_falls_back_to_text() {
        let q = parse_query("before:2026-13-99");
        assert_eq!(q.words, vec!["before:2026-13-99".to_string()]);
        assert_eq!(q.before, None);
    }

    #[test]
    fn unknown_prefix_falls_back_to_text() {
        let q = parse_query("author:zhang");
        assert_eq!(q.words, vec!["author:zhang".to_string()]);
    }

    #[test]
    fn cross_dimension_combination() {
        let q = parse_query("作业 type:docx label:course state:pending size:>1MB");
        assert_eq!(q.words, vec!["作业".to_string()]);
        assert_eq!(q.types, vec!["docx".to_string()]);
        assert_eq!(q.labels, vec!["course".to_string()]);
        assert_eq!(q.states, vec!["pending".to_string()]);
        assert_eq!(q.size_min, Some(1024 * 1024));
    }

    #[test]
    fn explicit_and_syntax_both_forms() {
        let q = parse_query("label:a AND label:b");
        assert_eq!(q.labels_all, vec!["a".to_string(), "b".to_string()]);
        assert!(q.labels.is_empty());

        let q = parse_query("+label:a +label:b");
        assert_eq!(q.labels_all, vec!["a".to_string(), "b".to_string()]);

        let q = parse_query("label:a label:b");
        assert_eq!(q.labels, vec!["a".to_string(), "b".to_string()]);
        assert!(q.labels_all.is_empty());
    }

    #[test]
    fn and_is_case_insensitive_and_chains() {
        let q = parse_query("label:a and label:b AND label:c");
        assert_eq!(
            q.labels_all,
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
        assert!(q.words.is_empty());
    }

    #[test]
    fn isolated_and_falls_back_to_text() {
        let q = parse_query("AND label:a");
        assert_eq!(q.words, vec!["AND".to_string()]);
        assert_eq!(q.labels, vec!["a".to_string()]);
        assert!(q.labels_all.is_empty());

        let q = parse_query("label:a AND");
        assert_eq!(q.labels, vec!["a".to_string()]);
        assert_eq!(q.words, vec!["AND".to_string()]);
    }

    #[test]
    fn or_and_mix() {
        let q = parse_query("label:a label:b +label:c");
        assert_eq!(q.labels, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(q.labels_all, vec!["c".to_string()]);

        let q = parse_query("label:a AND label:b label:c");
        assert_eq!(q.labels_all, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(q.labels, vec!["c".to_string()]);
    }

    #[test]
    fn cursor_roundtrip_and_invalid() {
        let cursor = encode_cursor(serde_json::json!("高等数学"), 42);
        let (value, id) = decode_cursor(&cursor).unwrap();
        assert_eq!(value, serde_json::json!("高等数学"));
        assert_eq!(id, 42);

        let cursor = encode_cursor(serde_json::json!(123456), 7);
        let (value, id) = decode_cursor(&cursor).unwrap();
        assert_eq!(value, serde_json::json!(123456));
        assert_eq!(id, 7);

        assert!(decode_cursor("not-json").is_err());
        assert!(decode_cursor("[1]").is_err());
        assert!(decode_cursor(r#"["a","b","c"]"#).is_err());
    }
}
