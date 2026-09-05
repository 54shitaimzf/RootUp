//! 自定义标签注册表模型：显示名 / 图标 / 颜色。
//!
//! 独立于 `settings.json` 与索引库持久化；内置大类不在注册表中，
//! 由前端只读展示。标签图标与颜色是标签自身属性，不走皮肤。
use serde::{Deserialize, Serialize};

/// 自定义标签数量上限。
pub const MAX_LABELS: usize = 100;
/// 标签 key 最大字节长度。
pub const MAX_KEY_LEN: usize = 32;
/// 标签显示名最大字符数。
pub const MAX_NAME_LEN: usize = 40;
/// icon / color 字段最大字节长度。
pub const MAX_STYLE_LEN: usize = 32;

/// 一个自定义标签定义。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LabelDef {
    pub key: String,
    pub name: String,
    pub icon: String,
    pub color: String,
}

impl LabelDef {
    /// key / name / icon / color 全部合法。
    pub fn is_valid(&self) -> bool {
        valid_key(&self.key)
            && valid_name(&self.name)
            && valid_style(&self.icon)
            && valid_style(&self.color)
    }
}

/// key：小写 `[a-z0-9-]`，1..=32 字节。
pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 显示名：trim 后非空且 ≤ [`MAX_NAME_LEN`] 字符。
pub fn valid_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= MAX_NAME_LEN
}

/// icon / color：trim 后非空、≤ [`MAX_STYLE_LEN`] 字节、仅小写字母数字与连字符。
/// 未知值由前端回退（Tag 图标 / 中性色），后端只保证数据安全。
pub fn valid_style(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty()
        && v.len() <= MAX_STYLE_LEN
        && v.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> LabelDef {
        LabelDef {
            key: "course".into(),
            name: "课程资料".into(),
            icon: "book".into(),
            color: "sky".into(),
        }
    }

    #[test]
    fn valid_def_passes() {
        assert!(sample().is_valid());
    }

    #[test]
    fn key_validation_matches_fixture() {
        let raw = include_str!("../../../fixtures/app-contracts.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/app-contracts.json 应可解析");
        let rule = &value["labelKey"];
        let max_len = rule["maxLength"].as_u64().expect("maxLength 应存在") as usize;
        assert_eq!(max_len, MAX_KEY_LEN, "maxLength 应与后端常量一致");
        for case in rule["accepts"].as_array().unwrap() {
            let key = case.as_str().unwrap();
            assert!(valid_key(key), "应接受 key={key:?}");
        }
        for case in rule["rejects"].as_array().unwrap() {
            let key = case.as_str().unwrap();
            assert!(!valid_key(key), "应拒绝 key={key:?}");
        }
        assert!(valid_key(&"a".repeat(max_len)));
        assert!(!valid_key(&"a".repeat(max_len + 1)));
    }

    #[test]
    fn key_validation_matrix() {
        assert!(valid_key("course"));
        assert!(valid_key("course-2026"));
        assert!(valid_key("a"));
        assert!(!valid_key(""));
        assert!(!valid_key("Course"));
        assert!(!valid_key("course 1"));
        assert!(!valid_key("course_1"));
        assert!(!valid_key(&"a".repeat(MAX_KEY_LEN + 1)));
        assert!(valid_key(&"a".repeat(MAX_KEY_LEN)));
    }

    #[test]
    fn name_validation_matrix() {
        assert!(valid_name("课程资料"));
        assert!(valid_name(" 数学 "));
        assert!(!valid_name(""));
        assert!(!valid_name("   "));
        assert!(!valid_name(&"长".repeat(MAX_NAME_LEN + 1)));
        assert!(valid_name(&"长".repeat(MAX_NAME_LEN)));
    }

    #[test]
    fn style_validation_matrix() {
        assert!(valid_style("book"));
        assert!(valid_style("code2"));
        assert!(valid_style(" sky "));
        assert!(!valid_style(""));
        assert!(!valid_style("   "));
        assert!(!valid_style("Book"));
        assert!(!valid_style("book icon"));
        assert!(!valid_style(&"a".repeat(MAX_STYLE_LEN + 1)));
    }

    #[test]
    fn invalid_def_rejected() {
        let mut def = sample();
        def.key = "BAD".into();
        assert!(!def.is_valid());

        let mut def = sample();
        def.name = "".into();
        assert!(!def.is_valid());

        let mut def = sample();
        def.icon = "".into();
        assert!(!def.is_valid());

        let mut def = sample();
        def.color = "".into();
        assert!(!def.is_valid());
    }

    #[test]
    fn unknown_fields_tolerated() {
        let json = r#"{"key":"course","name":"课程","icon":"book","color":"sky","future_field":1}"#;
        let def: LabelDef = serde_json::from_str(json).expect("未知字段不应导致解析失败");
        assert_eq!(def.key, "course");
        assert!(def.is_valid());
    }
}
