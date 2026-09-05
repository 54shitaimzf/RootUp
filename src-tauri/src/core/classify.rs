//! 可插拔的文件分类体系：类别枚举、分类器接口与内置扩展名映射（可配置覆盖）。
use std::collections::HashMap;

/// 文件大类类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Category {
    Document,
    Image,
    Video,
    Audio,
    Archive,
    Code,
    Installer,
    Data,
    Other,
}

impl Category {
    pub const ALL: [Category; 9] = [
        Category::Document,
        Category::Image,
        Category::Video,
        Category::Audio,
        Category::Archive,
        Category::Code,
        Category::Installer,
        Category::Data,
        Category::Other,
    ];

    /// 小写标签 key（同时是存储与前端映射的标识）。
    pub fn key(self) -> &'static str {
        match self {
            Category::Document => "document",
            Category::Image => "image",
            Category::Video => "video",
            Category::Audio => "audio",
            Category::Archive => "archive",
            Category::Code => "code",
            Category::Installer => "installer",
            Category::Data => "data",
            Category::Other => "other",
        }
    }
}

/// 内置扩展名 → 大类映射（单一来源，前端只读展示与分类器共用）。
pub static DEFAULT_EXTENSION_MAP: &[(&str, Category)] = &[
    ("pdf", Category::Document),
    ("doc", Category::Document),
    ("docx", Category::Document),
    ("docm", Category::Document),
    ("dotx", Category::Document),
    ("txt", Category::Document),
    ("md", Category::Document),
    ("rtf", Category::Document),
    ("odt", Category::Document),
    ("xls", Category::Document),
    ("xlsx", Category::Document),
    ("xlsm", Category::Document),
    ("csv", Category::Document),
    ("tsv", Category::Document),
    ("ppt", Category::Document),
    ("pptx", Category::Document),
    ("pptm", Category::Document),
    ("ppsx", Category::Document),
    ("epub", Category::Document),
    ("mobi", Category::Document),
    ("log", Category::Document),
    ("jpg", Category::Image),
    ("jpeg", Category::Image),
    ("png", Category::Image),
    ("gif", Category::Image),
    ("webp", Category::Image),
    ("bmp", Category::Image),
    ("svg", Category::Image),
    ("ico", Category::Image),
    ("heic", Category::Image),
    ("heif", Category::Image),
    ("tif", Category::Image),
    ("tiff", Category::Image),
    ("avif", Category::Image),
    ("jfif", Category::Image),
    ("mp4", Category::Video),
    ("mkv", Category::Video),
    ("avi", Category::Video),
    ("mov", Category::Video),
    ("wmv", Category::Video),
    ("flv", Category::Video),
    ("webm", Category::Video),
    ("m4v", Category::Video),
    ("mpeg", Category::Video),
    ("mpg", Category::Video),
    ("3gp", Category::Video),
    ("mp3", Category::Audio),
    ("wav", Category::Audio),
    ("flac", Category::Audio),
    ("aac", Category::Audio),
    ("ogg", Category::Audio),
    ("m4a", Category::Audio),
    ("wma", Category::Audio),
    ("opus", Category::Audio),
    ("aiff", Category::Audio),
    ("mka", Category::Audio),
    ("zip", Category::Archive),
    ("rar", Category::Archive),
    ("7z", Category::Archive),
    ("tar", Category::Archive),
    ("gz", Category::Archive),
    ("bz2", Category::Archive),
    ("xz", Category::Archive),
    ("tgz", Category::Archive),
    ("zst", Category::Archive),
    ("lz4", Category::Archive),
    ("cab", Category::Archive),
    ("iso", Category::Archive),
    ("rs", Category::Code),
    ("py", Category::Code),
    ("js", Category::Code),
    ("ts", Category::Code),
    ("tsx", Category::Code),
    ("jsx", Category::Code),
    ("html", Category::Code),
    ("css", Category::Code),
    ("scss", Category::Code),
    ("sass", Category::Code),
    ("less", Category::Code),
    ("java", Category::Code),
    ("c", Category::Code),
    ("cpp", Category::Code),
    ("cxx", Category::Code),
    ("h", Category::Code),
    ("hpp", Category::Code),
    ("hh", Category::Code),
    ("go", Category::Code),
    ("rb", Category::Code),
    ("php", Category::Code),
    ("swift", Category::Code),
    ("kt", Category::Code),
    ("kts", Category::Code),
    ("sh", Category::Code),
    ("bash", Category::Code),
    ("bat", Category::Code),
    ("cmd", Category::Code),
    ("ps1", Category::Code),
    ("psd1", Category::Code),
    ("json", Category::Code),
    ("yaml", Category::Code),
    ("yml", Category::Code),
    ("toml", Category::Code),
    ("xml", Category::Code),
    ("sql", Category::Code),
    ("ini", Category::Code),
    ("cfg", Category::Code),
    ("conf", Category::Code),
    ("vue", Category::Code),
    ("svelte", Category::Code),
    ("exe", Category::Installer),
    ("msi", Category::Installer),
    ("msix", Category::Installer),
    ("msp", Category::Installer),
    ("appx", Category::Installer),
    ("dmg", Category::Installer),
    ("pkg", Category::Installer),
    ("appimage", Category::Installer),
    ("deb", Category::Installer),
    ("rpm", Category::Installer),
    ("apk", Category::Installer),
    ("db", Category::Data),
    ("sqlite", Category::Data),
    ("sqlite3", Category::Data),
    ("db3", Category::Data),
    ("sqlitedb", Category::Data),
    ("parquet", Category::Data),
    ("avro", Category::Data),
    ("arrow", Category::Data),
];

/// 分类器输入：只读文件基础信息，未来 AI/课程分类器同样消费该结构。
#[derive(Debug, Clone, Copy)]
pub struct ClassifyInput<'a> {
    pub name: &'a str,
    pub file_type: &'a str,
    /// 完整路径：为未来基于目录/课程名匹配的分类器预留
    #[allow(dead_code)]
    pub path: &'a str,
    /// 文件大小：为未来按大小分类的分类器预留
    #[allow(dead_code)]
    pub size: u64,
}

/// 分类器接口：新分类机制（AI、课程匹配等）实现该 trait 后追加进链即可。
pub trait Classifier: Send + Sync {
    /// 分类器标识，写入日志供溯源。
    fn id(&self) -> &'static str;
    /// 返回标签 key 列表（可为空）。
    fn labels(&self, input: &ClassifyInput<'_>) -> Vec<String>;
}

/// 按扩展名映射大类的内置分类器（内置表 + 用户覆盖合并）。
pub struct ExtensionClassifier {
    overrides: HashMap<String, Category>,
}

impl ExtensionClassifier {
    pub fn new() -> Self {
        Self {
            overrides: HashMap::new(),
        }
    }

    /// 用户覆盖（扩展名列表 → 类别 key）：覆盖或新增内置映射，非法项忽略并记 warn。
    pub fn with_overrides(overrides: &[(Vec<String>, String)]) -> Self {
        let mut map = HashMap::new();
        for (extensions, category_key) in overrides {
            let Some(category) = Category::ALL.iter().find(|c| c.key() == category_key) else {
                log::warn!("classify: 忽略非法覆盖 category={category_key}");
                continue;
            };
            for ext in extensions {
                let ext = ext.trim().to_ascii_lowercase();
                if !ext.is_empty() && !ext.contains('.') {
                    map.insert(ext, *category);
                } else {
                    log::warn!("classify: 忽略非法覆盖 ext={ext}");
                }
            }
        }
        if !map.is_empty() {
            log::info!("classify: 应用覆盖 {} 条", map.len());
        }
        Self { overrides: map }
    }

    fn category_for(&self, file_type: &str) -> Option<Category> {
        let key = file_type.to_ascii_lowercase();
        if let Some(category) = self.overrides.get(&key) {
            return Some(*category);
        }
        default_categories_for(&key).into_iter().next()
    }
}

impl Default for ExtensionClassifier {
    fn default() -> Self {
        Self::new()
    }
}

/// 内置表查找（返回匹配类别，当前每个扩展名至多一个类别）。
pub fn default_categories_for(file_type: &str) -> Vec<Category> {
    DEFAULT_EXTENSION_MAP
        .iter()
        .filter(|(ext, _)| *ext == file_type)
        .map(|(_, category)| *category)
        .collect()
}

impl Classifier for ExtensionClassifier {
    fn id(&self) -> &'static str {
        "extension"
    }

    fn labels(&self, input: &ClassifyInput<'_>) -> Vec<String> {
        self.category_for(input.file_type)
            .map(|c| c.key().to_string())
            .into_iter()
            .collect()
    }
}

/// 顺序执行多个分类器并跨分类器去重，每个分类器输出记 debug 日志。
pub struct ClassifierChain {
    classifiers: Vec<Box<dyn Classifier>>,
}

impl ClassifierChain {
    pub fn new(classifiers: Vec<Box<dyn Classifier>>) -> Self {
        Self { classifiers }
    }

    /// 追加分类器（未来 AI/课程分类接入点）。
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn push(&mut self, classifier: Box<dyn Classifier>) {
        self.classifiers.push(classifier);
    }
}

impl Classifier for ClassifierChain {
    fn id(&self) -> &'static str {
        "chain"
    }

    fn labels(&self, input: &ClassifyInput<'_>) -> Vec<String> {
        let mut out = Vec::new();
        for classifier in &self.classifiers {
            let labels = classifier.labels(input);
            log::debug!(
                "classify: [{}] {:?} -> {:?}",
                classifier.id(),
                input.name,
                labels
            );
            for label in labels {
                if !out.contains(&label) {
                    out.push(label);
                }
            }
        }
        out
    }
}

/// 标签 key 合法性：小写字母、数字、连字符。
pub fn is_valid_label_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_keys_match_fixture() {
        let raw = include_str!("../../../fixtures/app-contracts.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/app-contracts.json 应可解析");
        let categories = value["categories"].as_array().expect("categories 应为数组");
        let expected: Vec<String> = Category::ALL.iter().map(|c| c.key().to_string()).collect();
        let actual: Vec<String> = categories
            .iter()
            .map(|v| v.as_str().expect("类别应为字符串").to_string())
            .collect();
        assert_eq!(actual, expected, "fixture categories 应与 Category::ALL 一致");
    }

    #[test]
    fn effective_map_matches_fixture() {
        let raw = include_str!("../../../fixtures/classify-effective-cases.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/classify-effective-cases.json 应可解析");
        let overrides: Vec<(Vec<String>, String)> = value["overrides"]
            .as_array()
            .expect("overrides 应为数组")
            .iter()
            .map(|rule| {
                (
                    rule["extensions"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_str().unwrap().to_string())
                        .collect(),
                    rule["category"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        let classifier = ExtensionClassifier::with_overrides(&overrides);
        for case in value["expectations"].as_array().expect("expectations 应为数组") {
            let ext = case["ext"].as_str().unwrap();
            let expected = case["category"].as_str();
            assert_eq!(
                classifier.category_for(ext).map(|c| c.key()),
                expected,
                "ext={ext} 生效类别与契约不符"
            );
        }
    }

    fn input<'a>(name: &'a str, file_type: &'a str) -> ClassifyInput<'a> {
        ClassifyInput {
            name,
            file_type,
            path: "C:/x",
            size: 1,
        }
    }

    #[test]
    fn common_extensions_map_to_categories() {
        let c = ExtensionClassifier::new();
        let cases = [
            ("a.pdf", "pdf", "document"),
            ("a.docx", "docx", "document"),
            ("a.csv", "csv", "document"),
            ("a.png", "png", "image"),
            ("a.svg", "svg", "image"),
            ("a.mp4", "mp4", "video"),
            ("a.mp3", "mp3", "audio"),
            ("a.zip", "zip", "archive"),
            ("a.tar.gz", "gz", "archive"),
            ("a.rs", "rs", "code"),
            ("a.ts", "ts", "code"),
            ("a.exe", "exe", "installer"),
            ("a.sqlite", "sqlite", "data"),
        ];
        for (name, file_type, expected) in cases {
            let labels = c.labels(&input(name, file_type));
            assert_eq!(
                labels,
                vec![expected.to_string()],
                "{name} 应映射为 {expected}"
            );
        }
    }

    #[test]
    fn extension_matching_is_case_insensitive() {
        let c = ExtensionClassifier::new();
        assert_eq!(
            c.labels(&input("A.PDF", "PDF")),
            vec!["document".to_string()]
        );
    }

    #[test]
    fn no_extension_and_unknown_extension_yield_no_labels() {
        let c = ExtensionClassifier::new();
        assert!(c.labels(&input("Makefile", "")).is_empty());
        assert!(c.labels(&input(".gitignore", "")).is_empty());
        assert!(c.labels(&input("weird.xyzabc", "xyzabc")).is_empty());
    }

    #[test]
    fn multi_extension_uses_last() {
        let c = ExtensionClassifier::new();
        assert_eq!(
            c.labels(&input("archive.tar.gz", "gz")),
            vec!["archive".to_string()]
        );
    }

    #[test]
    fn overrides_replace_and_extend_defaults() {
        // 覆盖：pdf -> code
        let c = ExtensionClassifier::with_overrides(&[(vec!["pdf".into()], "code".to_string())]);
        assert_eq!(c.labels(&input("a.pdf", "pdf")), vec!["code".to_string()]);
        // 新增：psd -> image
        let c = ExtensionClassifier::with_overrides(&[(vec!["psd".into()], "image".to_string())]);
        assert_eq!(c.labels(&input("a.psd", "psd")), vec!["image".to_string()]);
        // 未覆盖项保持默认
        assert_eq!(c.labels(&input("a.rs", "rs")), vec!["code".to_string()]);
    }

    #[test]
    fn overrides_normalize_case() {
        let c = ExtensionClassifier::with_overrides(&[(vec!["PDF".into()], "image".to_string())]);
        assert_eq!(c.labels(&input("a.pdf", "pdf")), vec!["image".to_string()]);
    }

    #[test]
    fn invalid_overrides_are_ignored() {
        let c = ExtensionClassifier::with_overrides(&[
            (vec!["psd".into()], "unknown".to_string()),
            (vec!["bad.ext".into()], "image".to_string()),
        ]);
        assert_eq!(c.labels(&input("a.psd", "psd")), Vec::<String>::new());
        assert_eq!(c.labels(&input("a.rs", "rs")), vec!["code".to_string()]);
    }

    #[test]
    fn default_map_covers_every_category() {
        // Other 保留给未来分类器（AI/课程），内置扩展名映射不强制覆盖
        for category in Category::ALL.iter().filter(|c| **c != Category::Other) {
            assert!(
                DEFAULT_EXTENSION_MAP.iter().any(|(_, c)| c == category),
                "内置映射应覆盖类别 {}",
                category.key()
            );
        }
        // 无重复扩展名
        let mut seen = std::collections::HashSet::new();
        for (ext, _) in DEFAULT_EXTENSION_MAP {
            assert!(seen.insert(*ext), "扩展名重复: {ext}");
        }
    }

    #[test]
    fn chain_deduplicates_across_classifiers() {
        let mut chain = ClassifierChain::new(vec![
            Box::new(ExtensionClassifier::new()),
            Box::new(DuplicateClassifier),
        ]);
        let labels = chain.labels(&input("a.pdf", "pdf"));
        assert_eq!(labels, vec!["document".to_string()]);
        chain.push(Box::new(ExtraClassifier));
        let labels = chain.labels(&input("a.pdf", "pdf"));
        assert_eq!(labels, vec!["document".to_string(), "extra".to_string()]);
    }

    struct DuplicateClassifier;
    impl Classifier for DuplicateClassifier {
        fn id(&self) -> &'static str {
            "duplicate"
        }
        fn labels(&self, _input: &ClassifyInput<'_>) -> Vec<String> {
            vec!["document".into()]
        }
    }

    struct ExtraClassifier;
    impl Classifier for ExtraClassifier {
        fn id(&self) -> &'static str {
            "extra"
        }
        fn labels(&self, _input: &ClassifyInput<'_>) -> Vec<String> {
            vec!["extra".into()]
        }
    }

    #[test]
    fn category_keys_are_stable_and_valid() {
        for category in Category::ALL {
            let key = category.key();
            assert!(is_valid_label_key(key), "无效标签 key: {key}");
        }
    }

    #[test]
    fn label_key_validation() {
        assert!(is_valid_label_key("document"));
        assert!(is_valid_label_key("my-label-2"));
        assert!(!is_valid_label_key(""));
        assert!(!is_valid_label_key("Doc"));
        assert!(!is_valid_label_key("has space"));
        assert!(!is_valid_label_key("has,comma"));
    }
}
