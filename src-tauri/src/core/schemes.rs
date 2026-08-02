//! 规则方案模型：忽略规则 + 分类覆盖的命名快照。
//!
//! 方案是用户的资产，独立于 `settings.json` 持久化；
//! 重置设置不会删除方案，方案也始终不包含主题/语言/监控目录。
use crate::core::settings::{ClassifyRule, IgnoreRules, MAX_CLASSIFY_RULES};
use serde::{Deserialize, Serialize};

/// 自定义方案数量上限。
pub const MAX_SCHEMES: usize = 20;

/// 方案名称最大字符数。
pub const MAX_NAME_LEN: usize = 40;

/// 一个命名规则方案（忽略规则 + 分类覆盖）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct RuleScheme {
    pub id: String,
    pub name: String,
    pub ignore_rules: IgnoreRules,
    pub classify_overrides: Vec<ClassifyRule>,
}

impl RuleScheme {
    /// 名称合法且规则全部合法。
    pub fn is_valid(&self) -> bool {
        valid_name(&self.name)
            && self.ignore_rules.is_valid()
            && self.classify_overrides.len() <= MAX_CLASSIFY_RULES
            && self.classify_overrides.iter().all(ClassifyRule::is_valid)
    }
}

/// 方案名称校验：trim 后非空且不超过 [`MAX_NAME_LEN`]。
pub fn valid_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= MAX_NAME_LEN
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::settings::Settings;

    fn sample_scheme() -> RuleScheme {
        RuleScheme {
            id: "s1".into(),
            name: "我的方案".into(),
            ignore_rules: Settings::default().ignore_rules,
            classify_overrides: vec![ClassifyRule {
                extensions: vec!["psd".into()],
                category: "image".into(),
            }],
        }
    }

    #[test]
    fn valid_scheme_passes() {
        assert!(sample_scheme().is_valid());
    }

    #[test]
    fn name_validation_matrix() {
        assert!(!valid_name(""));
        assert!(!valid_name("   "));
        assert!(!valid_name(&"长".repeat(MAX_NAME_LEN + 1)));
        assert!(valid_name(&"长".repeat(MAX_NAME_LEN)));
        assert!(valid_name(" 编程开发 "));
    }

    #[test]
    fn invalid_rules_rejected() {
        let mut scheme = sample_scheme();
        scheme.ignore_rules.extensions = vec![".crdownload".into()];
        assert!(!scheme.is_valid());

        let mut scheme = sample_scheme();
        scheme.classify_overrides[0].category = "unknown".into();
        assert!(!scheme.is_valid());
    }

    #[test]
    fn unknown_fields_tolerated_for_future_compatibility() {
        let json = r#"{
            "id":"s1",
            "name":"方案",
            "ignore_rules":{"extensions":["tmp"]},
            "classify_overrides":[],
            "future_field":123
        }"#;
        let scheme: RuleScheme = serde_json::from_str(json).expect("未知字段不应导致解析失败");
        assert_eq!(scheme.name, "方案");
        assert!(scheme.is_valid());
    }
}
