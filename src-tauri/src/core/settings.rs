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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: THEME_SYSTEM.to_string(),
            language: LANG_ZH_CN.to_string(),
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
