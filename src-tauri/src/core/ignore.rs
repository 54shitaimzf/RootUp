//! 忽略规则：过滤临时文件与编辑器杂项，避免误报。

/// 单条忽略规则。
#[derive(Debug, Clone, PartialEq, Eq)]
enum Rule {
    /// 按扩展名忽略（不区分大小写）
    Extension(String),
    /// 按前缀忽略
    Prefix(String),
    /// 按完整文件名忽略（不区分大小写，用于系统噪音文件）
    Exact(String),
    /// 按包裹字符忽略（如 `#name#`）
    Wrapped(char, char),
}

/// 忽略匹配器：命中规则的文件不进入索引与通知。
#[derive(Debug, Clone)]
pub struct IgnoreMatcher {
    rules: Vec<Rule>,
}

impl Default for IgnoreMatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl IgnoreMatcher {
    pub fn new() -> Self {
        Self::from_rules(
            &["crdownload", "part", "download", "tmp", "temp"],
            &["~$"],
            &["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"],
        )
    }

    /// 按规则集构造（默认规则不变，供测试注入与未来用户自定义规则）。
    pub fn from_rules(extensions: &[&str], prefixes: &[&str], exact: &[&str]) -> Self {
        let mut rules = Vec::new();
        rules.extend(
            extensions
                .iter()
                .map(|e| Rule::Extension(e.to_ascii_lowercase())),
        );
        rules.extend(
            prefixes
                .iter()
                .map(|p| Rule::Prefix(p.to_ascii_lowercase())),
        );
        rules.extend(exact.iter().map(|e| Rule::Exact(e.to_ascii_lowercase())));
        rules.push(Rule::Wrapped('#', '#'));
        Self { rules }
    }

    /// 判断文件名是否应被忽略。
    pub fn is_ignored(&self, name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        self.rules.iter().any(|rule| match rule {
            Rule::Extension(ext) => lower
                .rsplit_once('.')
                .map(|(_, e)| e == ext)
                .unwrap_or(false),
            Rule::Prefix(prefix) => lower.starts_with(prefix),
            Rule::Exact(name) => lower == *name,
            Rule::Wrapped(open, close) => {
                lower.len() >= 2 && lower.starts_with(*open) && lower.ends_with(*close)
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_extensions_ignored() {
        let m = IgnoreMatcher::new();
        for name in [
            "movie.mkv.crdownload",
            "paper.pdf.part",
            "archive.zip.download",
            "notes.tmp",
            "notes.temp",
        ] {
            assert!(m.is_ignored(name), "应忽略: {name}");
        }
    }

    #[test]
    fn editor_artifacts_ignored() {
        let m = IgnoreMatcher::new();
        assert!(m.is_ignored("~$report.docx"));
        assert!(m.is_ignored("#code.rs#"));
    }

    #[test]
    fn normal_files_pass() {
        let m = IgnoreMatcher::new();
        for name in [
            "courseware.pdf",
            "assignment.docx",
            "main.rs",
            "notes.txt",
            "image.PNG",
            "no_extension",
        ] {
            assert!(!m.is_ignored(name), "不应忽略: {name}");
        }
    }

    #[test]
    fn extension_matching_is_case_insensitive() {
        let m = IgnoreMatcher::new();
        assert!(m.is_ignored("video.CRDOWNLOAD"));
        assert!(m.is_ignored("video.CrDownload"));
    }

    #[test]
    fn wrapped_rule_requires_both_sides() {
        let m = IgnoreMatcher::new();
        assert!(!m.is_ignored("#incomplete"));
        assert!(!m.is_ignored("incomplete#"));
    }

    #[test]
    fn empty_and_dot_only_names() {
        let m = IgnoreMatcher::new();
        assert!(!m.is_ignored(""));
        assert!(!m.is_ignored("."));
        assert!(!m.is_ignored(".."));
    }

    #[test]
    fn dot_only_transient_file_is_ignored() {
        // 纯扩展名文件（如浏览器下载的 ".crdownload"）应视为临时文件
        let m = IgnoreMatcher::new();
        assert!(m.is_ignored(".crdownload"));
        assert!(m.is_ignored(".tmp"));
    }

    #[test]
    fn system_noise_files_ignored() {
        let m = IgnoreMatcher::new();
        for name in ["desktop.ini", "Thumbs.db", ".DS_Store", "$RECYCLE.BIN"] {
            assert!(m.is_ignored(name), "应忽略系统噪音: {name}");
        }
        assert!(!m.is_ignored("desktop.ini.bak"));
        assert!(!m.is_ignored("thumbs2.db"));
    }

    #[test]
    fn custom_rules_injected() {
        let m = IgnoreMatcher::from_rules(&["part"], &["tmp_"], &["secret.tmp"]);
        assert!(m.is_ignored("x.part"));
        assert!(m.is_ignored("tmp_foo.txt"));
        assert!(m.is_ignored("SECRET.TMP"));
        assert!(!m.is_ignored("normal.pdf"));
        // 默认的 Wrapped 规则仍保留
        assert!(m.is_ignored("#code.rs#"));
    }
}
