//! 应用设置模型：纯 Rust 数据 + 版本化 + 校验。
use crate::core::classify::Category;
use crate::core::path::path_key;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const THEME_SYSTEM: &str = "system";
pub const THEME_LIGHT: &str = "light";
pub const THEME_DARK: &str = "dark";

pub const LANG_ZH_CN: &str = "zh-CN";
pub const LANG_EN: &str = "en";

pub const PREFERRED_IDE_AUTO: &str = "auto";
pub const PREFERRED_IDE_VSCODE: &str = "vscode";
pub const PREFERRED_IDE_CURSOR: &str = "cursor";
pub const PREFERRED_IDE_IDEA: &str = "idea";
pub const PREFERRED_IDE_PYCHARM: &str = "pycharm";
pub const PREFERRED_IDE_RUSTROVER: &str = "rustrover";
pub const PREFERRED_IDE_GOLAND: &str = "goland";
pub const PREFERRED_IDE_NONE: &str = "none";
pub const PREFERRED_IDE_VALUES: &[&str] = &[
    PREFERRED_IDE_AUTO,
    PREFERRED_IDE_VSCODE,
    PREFERRED_IDE_CURSOR,
    PREFERRED_IDE_IDEA,
    PREFERRED_IDE_PYCHARM,
    PREFERRED_IDE_RUSTROVER,
    PREFERRED_IDE_GOLAND,
    PREFERRED_IDE_NONE,
];

/// 用户自定义打开命令上限。
pub const MAX_CUSTOM_OPEN_COMMANDS: usize = 10;

/// 当前配置版本（首个正式版本为 1）。
///
/// 向前兼容约定：
/// - 新增字段必须带 `#[serde(default)]`，结构体不启用 `deny_unknown_fields`，
///   旧版本配置文件永远可被新版本读取；
/// - 结构性升级在 [`Settings::migrate`] 中按版本号逐级迁移。
pub const CURRENT_VERSION: u32 = 2;

/// 用户分类覆盖规则上限。
pub const MAX_CLASSIFY_RULES: usize = 100;

/// 忽略规则：临时扩展名 / 文件名前缀 / 完整文件名（目录名）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct IgnoreRules {
    /// 临时扩展名（不含点、小写），如 `crdownload`
    pub extensions: Vec<String>,
    /// 文件名前缀，如 `~$`
    pub prefixes: Vec<String>,
    /// 完整文件名或目录名，如 `desktop.ini`
    pub exact_names: Vec<String>,
}

/// 分类覆盖规则：一组扩展名映射到某个类别 key。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyRule {
    /// 扩展名列表（不含点、小写）
    pub extensions: Vec<String>,
    /// 类别 key（`Category::ALL` 之一）
    pub category: String,
}

/// 用户自定义打开命令（最高优先；command 为可执行文件路径或命令名）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CustomOpenCommand {
    pub name: String,
    pub command: String,
    /// 关联工具 key（空 = 通用最后兜底）
    pub tool: String,
}

/// 应用设置模型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "zh-CN" | "en"
    pub language: String,
    /// 监控目录列表
    pub watched_dirs: Vec<String>,
    /// 忽略规则（可配置，默认覆盖常见临时/系统文件）
    pub ignore_rules: IgnoreRules,
    /// 用户分类覆盖（内置映射之上追加/改类）
    pub classify_overrides: Vec<ClassifyRule>,
    /// 手动添加的项目目录（独立于监控目录，仅用于打开/快捷方式）
    pub project_dirs: Vec<String>,
    /// 首选 IDE（auto 自动探测 / none 一律资源管理器回退）
    pub preferred_ide: String,
    /// 用户自定义打开命令（最高优先）
    pub custom_open_commands: Vec<CustomOpenCommand>,
    /// 归档根目录（空 = 未配置）
    pub archive_root: String,
    /// 自动归档开关（仅新稳定文件 + 分类明确非 other）
    pub auto_archive: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            theme: THEME_SYSTEM.to_string(),
            language: LANG_ZH_CN.to_string(),
            watched_dirs: Vec::new(),
            ignore_rules: IgnoreRules {
                extensions: ["crdownload", "part", "download", "tmp", "temp"]
                    .map(String::from)
                    .to_vec(),
                prefixes: vec!["~$".to_string()],
                exact_names: ["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"]
                    .map(String::from)
                    .to_vec(),
            },
            classify_overrides: Vec::new(),
            project_dirs: Vec::new(),
            preferred_ide: PREFERRED_IDE_AUTO.to_string(),
            custom_open_commands: Vec::new(),
            archive_root: String::new(),
            auto_archive: false,
        }
    }
}

impl Settings {
    /// 版本升级（逐级迁移）；当前 v1 为幂等空迁移。
    pub fn migrate(&mut self) {
        while self.version < CURRENT_VERSION {
            // 1 -> 2：新增 archive_root / auto_archive，缺失字段由 serde default 填充，
            // 无需数据转换，仅提升版本号。
            self.version = CURRENT_VERSION;
        }
    }

    /// 校验全部字段；非法值直接拒绝写入。
    pub fn is_valid(&self) -> bool {
        matches!(self.theme.as_str(), THEME_SYSTEM | THEME_LIGHT | THEME_DARK)
            && matches!(self.language.as_str(), LANG_ZH_CN | LANG_EN)
            && self.ignore_rules.is_valid()
            && self.classify_overrides.len() <= MAX_CLASSIFY_RULES
            && self.classify_overrides.iter().all(ClassifyRule::is_valid)
            && PREFERRED_IDE_VALUES.contains(&self.preferred_ide.as_str())
            && self.custom_open_commands.len() <= MAX_CUSTOM_OPEN_COMMANDS
            && self
                .custom_open_commands
                .iter()
                .all(CustomOpenCommand::is_valid)
            && self.archive_root.len() <= 1024
            && valid_non_empty(&self.project_dirs)
    }
}

impl CustomOpenCommand {
    pub fn is_valid(&self) -> bool {
        let name = self.name.trim();
        let command = self.command.trim();
        (1..=40).contains(&name.chars().count())
            && (1..=260).contains(&command.chars().count())
            && self.tool.chars().count() <= 40
    }
}

impl IgnoreRules {
    pub fn is_valid(&self) -> bool {
        valid_extensions(&self.extensions)
            && valid_non_empty(&self.prefixes)
            && valid_non_empty(&self.exact_names)
    }
}

impl ClassifyRule {
    pub fn is_valid(&self) -> bool {
        !self.extensions.is_empty()
            && valid_extensions(&self.extensions)
            && Category::ALL.iter().any(|c| c.key() == self.category)
    }
}

/// 扩展名合法性：非空、无点、小写字母数字连字符、不重复。
fn valid_extensions(items: &[String]) -> bool {
    let mut seen = HashSet::new();
    items.iter().all(|item| {
        let trimmed = item.trim();
        !trimmed.is_empty()
            && !trimmed.contains('.')
            && trimmed
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && seen.insert(trimmed.to_string())
    })
}

/// 非空字符串列表（允许为空列表）。
fn valid_non_empty(items: &[String]) -> bool {
    items.iter().all(|item| !item.trim().is_empty())
}

/// 恢复默认：主题/语言/规则/映射重置，保留监控目录（防误操作丢目录）。
pub fn reset_to_default(current: &Settings) -> Settings {
    Settings {
        watched_dirs: current.watched_dirs.clone(),
        project_dirs: current.project_dirs.clone(),
        ..Default::default()
    }
}

/// 归档根是否与任一监控目录冲突（相等即冲突，避免跳过整个监控目录）。
pub fn archive_root_conflicts(settings: &Settings) -> bool {
    !settings.archive_root.trim().is_empty()
        && settings
            .watched_dirs
            .iter()
            .any(|d| path_key(d) == path_key(&settings.archive_root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(theme: &str, language: &str) -> Settings {
        Settings {
            theme: theme.to_string(),
            language: language.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn default_values() {
        let s = Settings::default();
        assert_eq!(s.version, CURRENT_VERSION);
        assert_eq!(s.theme, THEME_SYSTEM);
        assert_eq!(s.language, LANG_ZH_CN);
        assert!(s.watched_dirs.is_empty());
        assert_eq!(
            s.ignore_rules.extensions,
            vec!["crdownload", "part", "download", "tmp", "temp"]
        );
        assert_eq!(s.ignore_rules.prefixes, vec!["~$"]);
        assert_eq!(
            s.ignore_rules.exact_names,
            vec!["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"]
        );
        assert!(s.classify_overrides.is_empty());
        assert!(s.is_valid());
    }

    #[test]
    fn missing_version_and_new_fields_default_to_current() {
        // 未发布过；但未来旧文件缺少新字段时必须可读并取默认
        let legacy = r#"{"theme":"dark","language":"en"}"#;
        let settings: Settings = serde_json::from_str(legacy).expect("旧配置应可读");
        assert_eq!(settings.version, CURRENT_VERSION);
        assert_eq!(settings.ignore_rules.extensions.len(), 5);
        assert!(settings.classify_overrides.is_empty());
        assert!(settings.is_valid());
    }

    #[test]
    fn unknown_fields_are_tolerated_for_future_compatibility() {
        // 未来版本新增字段后，本版本生成的文件仍可被未来版本读取（serde 默认忽略未知字段）
        let json = r#"{"theme":"dark","language":"en","watched_dirs":["C:/x"],"future_field":123}"#;
        let settings: Settings = serde_json::from_str(json).expect("未知字段不应导致解析失败");
        assert_eq!(settings.theme, THEME_DARK);
        assert_eq!(settings.watched_dirs, vec!["C:/x"]);
    }

    #[test]
    fn migrate_is_idempotent_on_v1() {
        let mut s = Settings::default();
        s.migrate();
        assert_eq!(s.version, CURRENT_VERSION);
    }

    #[test]
    fn archive_fields_default_off_and_migrate_v1_to_v2() {
        let s = Settings::default();
        assert_eq!(s.version, 2);
        assert_eq!(s.archive_root, "");
        assert!(!s.auto_archive);

        let json = r#"{
            "version": 1,
            "theme": "system",
            "language": "zh-CN",
            "watched_dirs": ["C:/Watch"],
            "ignore_rules": {"extensions": [], "prefixes": [], "exact_names": []},
            "classify_overrides": [],
            "project_dirs": [],
            "preferred_ide": "auto",
            "custom_open_commands": []
        }"#;
        let mut settings: Settings = serde_json::from_str(json).unwrap();
        settings.migrate();
        assert_eq!(settings.version, 2);
        assert_eq!(settings.archive_root, "");
        assert!(!settings.auto_archive);
        assert!(settings.is_valid());
    }

    #[test]
    fn reset_keeps_dirs_but_clears_archive_config() {
        let current = Settings {
            watched_dirs: vec!["C:/Watch".into()],
            project_dirs: vec!["C:/Proj".into()],
            archive_root: "C:/Archive".into(),
            auto_archive: true,
            ..Default::default()
        };
        let reset = reset_to_default(&current);
        assert_eq!(reset.watched_dirs, vec!["C:/Watch"]);
        assert_eq!(reset.project_dirs, vec!["C:/Proj"]);
        assert_eq!(reset.archive_root, "");
        assert!(!reset.auto_archive);
    }

    #[test]
    fn archive_root_conflicts_with_watched_dir() {
        let settings = Settings {
            watched_dirs: vec!["C:/Watch".into()],
            archive_root: "c:/watch".into(),
            ..Default::default()
        };
        assert!(archive_root_conflicts(&settings));
        let settings = Settings {
            watched_dirs: vec!["C:/Watch".into()],
            archive_root: "C:/Watch/sub".into(),
            ..Default::default()
        };
        assert!(!archive_root_conflicts(&settings));
        assert!(!archive_root_conflicts(&Settings::default()));
    }

    #[test]
    fn valid_theme_language_matrix() {
        for theme in [THEME_SYSTEM, THEME_LIGHT, THEME_DARK] {
            for language in [LANG_ZH_CN, LANG_EN] {
                assert!(settings(theme, language).is_valid());
            }
        }
    }

    #[test]
    fn invalid_theme_and_language_rejected() {
        assert!(!settings("blue", LANG_ZH_CN).is_valid());
        assert!(!settings(THEME_DARK, "fr").is_valid());
    }

    #[test]
    fn round_trip_with_all_fields() {
        let mut s = settings(THEME_LIGHT, LANG_ZH_CN);
        s.watched_dirs = vec!["D:/Downloads".into()];
        s.ignore_rules.extensions.push("zzz".into());
        s.classify_overrides.push(ClassifyRule {
            extensions: vec!["psd".into(), "ai".into()],
            category: "image".into(),
        });
        let json = serde_json::to_string(&s).unwrap();
        let restored: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, s.version);
        assert_eq!(restored.ignore_rules.extensions, s.ignore_rules.extensions);
        assert_eq!(restored.classify_overrides.len(), 1);
        assert!(restored.is_valid());
    }

    #[test]
    fn ignore_rules_validation_matrix() {
        let mut s = settings(THEME_SYSTEM, LANG_ZH_CN);
        // 非法：含点、大写、空串、重复
        s.ignore_rules.extensions = vec![".crdownload".into()];
        assert!(!s.is_valid());
        s.ignore_rules.extensions = vec!["CRDOWNLOAD".into()];
        assert!(!s.is_valid());
        s.ignore_rules.extensions = vec!["tmp".into(), "tmp".into()];
        assert!(!s.is_valid());
        s.ignore_rules.extensions = vec!["tmp".into(), "".into()];
        assert!(!s.is_valid());
        // 前缀与 exact 允许任意非空
        s.ignore_rules.extensions = vec!["tmp".into()];
        s.ignore_rules.prefixes = vec!["my-".into()];
        s.ignore_rules.exact_names = vec!["desktop.ini".into()];
        assert!(s.is_valid());
        // 允许清空列表
        s.ignore_rules.extensions.clear();
        assert!(s.is_valid());
    }

    #[test]
    fn classify_overrides_validation() {
        let mut s = settings(THEME_SYSTEM, LANG_ZH_CN);
        s.classify_overrides.push(ClassifyRule {
            extensions: vec!["psd".into()],
            category: "image".into(),
        });
        assert!(s.is_valid());
        // 非法类别
        s.classify_overrides[0].category = "unknown".into();
        assert!(!s.is_valid());
        // 空扩展名列表
        s.classify_overrides[0].category = "image".into();
        s.classify_overrides[0].extensions.clear();
        assert!(!s.is_valid());
        // 超上限
        s.classify_overrides[0].extensions = vec!["psd".into()];
        s.classify_overrides[0].category = "image".into();
        for _ in 0..MAX_CLASSIFY_RULES {
            s.classify_overrides.push(ClassifyRule {
                extensions: vec!["ext".into()],
                category: "code".into(),
            });
        }
        assert!(!s.is_valid());
    }

    #[test]
    fn reset_preserves_watched_dirs() {
        let mut s = settings(THEME_DARK, LANG_EN);
        s.watched_dirs = vec!["C:/Downloads".into()];
        s.project_dirs = vec!["E:/proj".into()];
        s.ignore_rules.extensions.push("zzz".into());
        let reset = reset_to_default(&s);
        assert_eq!(reset.watched_dirs, vec!["C:/Downloads"]);
        assert_eq!(reset.project_dirs, vec!["E:/proj"]);
        assert_eq!(reset.theme, THEME_SYSTEM);
        assert_eq!(reset.language, LANG_ZH_CN);
        assert_eq!(reset.ignore_rules.extensions.len(), 5);
        assert!(reset.classify_overrides.is_empty());
        assert!(reset.is_valid());
    }

    #[test]
    fn new_project_fields_default_and_valid() {
        let s = Settings::default();
        assert!(s.project_dirs.is_empty());
        assert_eq!(s.preferred_ide, PREFERRED_IDE_AUTO);
        assert!(s.custom_open_commands.is_empty());
        assert!(s.is_valid());
    }

    #[test]
    fn preferred_ide_whitelist() {
        for value in PREFERRED_IDE_VALUES {
            let s = Settings {
                preferred_ide: (*value).to_string(),
                ..Default::default()
            };
            assert!(s.is_valid(), "value={value}");
        }
        let s = Settings {
            preferred_ide: "vim".into(),
            ..Default::default()
        };
        assert!(!s.is_valid());
    }

    #[test]
    fn custom_open_command_validation_matrix() {
        let mut s = Settings {
            custom_open_commands: vec![CustomOpenCommand {
                name: "Typora".into(),
                command: "C:/Program Files/Typora/Typora.exe".into(),
                tool: "typora".into(),
            }],
            ..Default::default()
        };
        assert!(s.is_valid());

        s.custom_open_commands[0].name = "   ".into();
        assert!(!s.is_valid());
        s.custom_open_commands[0].name = "x".repeat(41);
        assert!(!s.is_valid());
        s.custom_open_commands[0].name = "OK".into();
        s.custom_open_commands[0].command = String::new();
        assert!(!s.is_valid());

        s.custom_open_commands = (0..11)
            .map(|i| CustomOpenCommand {
                name: format!("n{i}"),
                command: format!("c{i}"),
                tool: String::new(),
            })
            .collect();
        assert!(!s.is_valid());
    }
}
