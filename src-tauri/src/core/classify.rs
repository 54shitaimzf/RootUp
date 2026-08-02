//! 可插拔的文件分类体系：类别枚举、分类器接口与内置扩展名映射。

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

/// 按扩展名映射大类的内置分类器。
pub struct ExtensionClassifier;

impl ExtensionClassifier {
    fn categories_for(file_type: &str) -> &'static [Category] {
        match file_type {
            "pdf" | "doc" | "docx" | "docm" | "dotx" | "txt" | "md" | "rtf" | "odt" | "xls"
            | "xlsx" | "xlsm" | "csv" | "tsv" | "ppt" | "pptx" | "pptm" | "ppsx" | "epub"
            | "mobi" | "log" => &[Category::Document],
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" | "heic" | "heif"
            | "tif" | "tiff" | "avif" | "jfif" => &[Category::Image],
            "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpeg" | "mpg"
            | "3gp" => &[Category::Video],
            "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "aiff" | "mka" => {
                &[Category::Audio]
            }
            "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "tgz" | "zst" | "lz4" | "cab"
            | "iso" => &[Category::Archive],
            "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "html" | "css" | "scss" | "sass"
            | "less" | "java" | "c" | "cpp" | "cxx" | "h" | "hpp" | "hh" | "go" | "rb" | "php"
            | "swift" | "kt" | "kts" | "sh" | "bash" | "bat" | "cmd" | "ps1" | "psd1" | "json"
            | "yaml" | "yml" | "toml" | "xml" | "sql" | "ini" | "cfg" | "conf" | "vue"
            | "svelte" => &[Category::Code],
            "exe" | "msi" | "msix" | "msp" | "appx" | "dmg" | "pkg" | "appimage" | "deb"
            | "rpm" | "apk" => &[Category::Installer],
            "db" | "sqlite" | "sqlite3" | "db3" | "sqlitedb" | "parquet" | "avro" | "arrow" => {
                &[Category::Data]
            }
            _ => &[],
        }
    }
}

impl Classifier for ExtensionClassifier {
    fn id(&self) -> &'static str {
        "extension"
    }

    fn labels(&self, input: &ClassifyInput<'_>) -> Vec<String> {
        Self::categories_for(&input.file_type.to_ascii_lowercase())
            .iter()
            .map(|c| c.key().to_string())
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
        let c = ExtensionClassifier;
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
        assert_eq!(
            c.labels(&input("a.pdf", "pdf")),
            vec!["document".to_string()]
        );
        assert_eq!(c.labels(&input("a.rs", "rs")), vec!["code".to_string()]);
    }

    #[test]
    fn extension_matching_is_case_insensitive() {
        let c = ExtensionClassifier;
        assert_eq!(
            c.labels(&input("A.PDF", "PDF")),
            vec!["document".to_string()]
        );
    }

    #[test]
    fn no_extension_and_unknown_extension_yield_no_labels() {
        let c = ExtensionClassifier;
        assert!(c.labels(&input("Makefile", "")).is_empty());
        assert!(c.labels(&input(".gitignore", "")).is_empty());
        assert!(c.labels(&input("weird.xyzabc", "xyzabc")).is_empty());
    }

    #[test]
    fn multi_extension_uses_last() {
        let c = ExtensionClassifier;
        // tar.gz 取最后一个扩展名 gz -> archive
        assert_eq!(
            c.labels(&input("archive.tar.gz", "gz")),
            vec!["archive".to_string()]
        );
    }

    #[test]
    fn chain_deduplicates_across_classifiers() {
        let mut chain = ClassifierChain::new(vec![
            Box::new(ExtensionClassifier),
            Box::new(DuplicateClassifier),
        ]);
        let labels = chain.labels(&input("a.pdf", "pdf"));
        assert_eq!(labels, vec!["document".to_string()]);
        // 可追加新分类器
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
