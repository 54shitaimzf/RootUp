//! 索引搜索语法：解析 `type:` / `label:` / `state:` / `size:` / `before:` / `after:` 与普通文本。
use crate::core::index::FileRecord;
use chrono::TimeZone;
use serde::Serialize;

/// 结构化查询：同维度多值 OR，跨维度与文本 token AND。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
    /// 普通文本 token（按 name/path LIKE 匹配，多个 token 全部命中）
    pub words: Vec<String>,
    /// `type:` 精确扩展名（小写）
    pub types: Vec<String>,
    /// `label:` / `tag:` 标签 key
    pub labels: Vec<String>,
    /// `state:` / `status:` 状态
    pub states: Vec<String>,
    pub size_min: Option<i64>,
    pub size_max: Option<i64>,
    /// modified <= before（毫秒）
    pub before: Option<i64>,
    /// modified >= after（毫秒）
    pub after: Option<i64>,
    pub limit: i64,
    pub offset: i64,
}

/// 查询结果页：记录与总数（分页用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPage {
    pub items: Vec<FileRecord>,
    pub total: i64,
}

const VALID_STATES: [&str; 4] = ["pending", "indexed", "archived", "deleted"];

/// 解析搜索字符串为结构化查询；非法值与未知前缀回落为普通文本。
pub fn parse_query(input: &str) -> FileQuery {
    let mut query = FileQuery::default();
    for token in input.split_whitespace() {
        if let Some(value) = token.strip_prefix("type:") {
            push_non_empty(&mut query.types, &value.to_ascii_lowercase());
        } else if let Some(value) = token.strip_prefix("label:") {
            push_non_empty(&mut query.labels, value);
        } else if let Some(value) = token.strip_prefix("tag:") {
            push_non_empty(&mut query.labels, value);
        } else if let Some(value) = token.strip_prefix("state:") {
            push_state(&mut query, value);
        } else if let Some(value) = token.strip_prefix("status:") {
            push_state(&mut query, value);
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

fn push_non_empty(target: &mut Vec<String>, value: &str) {
    if !value.is_empty() && !target.iter().any(|v| v == value) {
        target.push(value.to_string());
    }
}

fn push_state(query: &mut FileQuery, value: &str) {
    let lower = value.to_ascii_lowercase();
    if VALID_STATES.contains(&lower.as_str()) {
        push_non_empty(&mut query.states, &lower);
    } else {
        query.words.push(format!("state:{value}"));
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
}
