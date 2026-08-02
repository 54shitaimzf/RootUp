use serde::{Deserialize, Serialize};

pub const THEME_SYSTEM: &str = "system";
pub const THEME_LIGHT: &str = "light";
pub const THEME_DARK: &str = "dark";

pub const LANG_ZH_CN: &str = "zh-CN";
pub const LANG_EN: &str = "en";

/// 应用设置模型。
///
/// 位于 core 层：纯 Rust 数据结构，不依赖任何 Tauri 类型，
/// 便于后续扩展字段与单元测试。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "zh-CN" | "en"
    pub language: String,
    /// 监控目录列表（迭代 A：文件监听与索引）
    #[serde(default)]
    pub watched_dirs: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: THEME_SYSTEM.to_string(),
            language: LANG_ZH_CN.to_string(),
            watched_dirs: Vec::new(),
        }
    }
}

impl Settings {
    /// 校验字段取值，非法值直接拒绝写入，防止脏数据进入存储。
    pub fn is_valid(&self) -> bool {
        matches!(self.theme.as_str(), THEME_SYSTEM | THEME_LIGHT | THEME_DARK)
            && matches!(self.language.as_str(), LANG_ZH_CN | LANG_EN)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(theme: &str, language: &str) -> Settings {
        Settings {
            theme: theme.to_string(),
            language: language.to_string(),
            watched_dirs: Vec::new(),
        }
    }

    #[test]
    fn default_values() {
        let s = Settings::default();
        assert_eq!(s.theme, THEME_SYSTEM);
        assert_eq!(s.language, LANG_ZH_CN);
        assert!(s.watched_dirs.is_empty());
        assert!(s.is_valid());
    }

    #[test]
    fn valid_theme_language_matrix() {
        for theme in [THEME_SYSTEM, THEME_LIGHT, THEME_DARK] {
            for language in [LANG_ZH_CN, LANG_EN] {
                assert!(
                    settings(theme, language).is_valid(),
                    "应为合法: {theme}/{language}"
                );
            }
        }
    }

    #[test]
    fn invalid_theme_rejected() {
        for theme in ["blue", "auto", "", "SYSTEM"] {
            assert!(
                !settings(theme, LANG_ZH_CN).is_valid(),
                "应拒绝非法主题: {theme}"
            );
        }
    }

    #[test]
    fn invalid_language_rejected() {
        for language in ["fr", "zh", "", "EN"] {
            assert!(
                !settings(THEME_DARK, language).is_valid(),
                "应拒绝非法语言: {language}"
            );
        }
    }

    #[test]
    fn legacy_json_without_watched_dirs_deserializes() {
        // 旧版本设置没有 watched_dirs 字段，必须兼容
        let legacy = r#"{"theme":"dark","language":"en"}"#;
        let settings: Settings = serde_json::from_str(legacy).expect("旧设置反序列化失败");
        assert_eq!(settings.theme, THEME_DARK);
        assert_eq!(settings.language, LANG_EN);
        assert!(settings.watched_dirs.is_empty());
        assert!(settings.is_valid());
    }

    #[test]
    fn round_trip_with_watched_dirs() {
        let mut s = settings(THEME_LIGHT, LANG_ZH_CN);
        s.watched_dirs = vec!["D:\\Downloads".into(), "C:\\Courses".into()];
        let json = serde_json::to_string(&s).unwrap();
        let restored: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.watched_dirs, s.watched_dirs);
        assert!(restored.is_valid());
    }

    #[test]
    fn watched_dirs_do_not_affect_validity() {
        let mut s = settings(THEME_SYSTEM, LANG_ZH_CN);
        s.watched_dirs = vec!["any/path".into()];
        assert!(s.is_valid());
    }
}
