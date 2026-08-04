//! 打开意图：项目类型 / 文件扩展名 → 工具候选（单一来源、可测试）。
//!
//! Office/PDF 与未映射类型交给系统默认程序（最稳，尊重用户关联）。
use crate::core::project::ProjectKind;

pub const TOOL_VSCODE: &str = "vscode";
pub const TOOL_CURSOR: &str = "cursor";
pub const TOOL_IDEA: &str = "idea";
pub const TOOL_PYCHARM: &str = "pycharm";
pub const TOOL_RUSTROVER: &str = "rustrover";
pub const TOOL_GOLAND: &str = "goland";
pub const TOOL_UNITY_HUB: &str = "unityhub";
pub const TOOL_UNITY_EDITOR: &str = "unityeditor";
pub const TOOL_TYPORA: &str = "typora";
pub const TOOL_OBSIDIAN: &str = "obsidian";
pub const TOOL_JUPYTER: &str = "jupyter";
pub const TOOL_MATLAB: &str = "matlab";
pub const TOOL_ORIGIN: &str = "origin";
pub const TOOL_MATHEMATICA: &str = "mathematica";
pub const TOOL_MULTISIM: &str = "multisim";
pub const TOOL_PROTEUS: &str = "proteus";
pub const TOOL_CAD: &str = "cad";
pub const TOOL_SOLIDWORKS: &str = "solidworks";
pub const TOOL_PHOTOSHOP: &str = "photoshop";
pub const TOOL_ILLUSTRATOR: &str = "illustrator";
pub const TOOL_TEXSTUDIO: &str = "texstudio";
pub const TOOL_TEXWORKS: &str = "texworks";

/// 全部工具 key（检测与文档共用）。
pub const TOOL_KEYS: &[&str] = &[
    TOOL_VSCODE,
    TOOL_CURSOR,
    TOOL_IDEA,
    TOOL_PYCHARM,
    TOOL_RUSTROVER,
    TOOL_GOLAND,
    TOOL_UNITY_HUB,
    TOOL_UNITY_EDITOR,
    TOOL_TYPORA,
    TOOL_OBSIDIAN,
    TOOL_JUPYTER,
    TOOL_MATLAB,
    TOOL_ORIGIN,
    TOOL_MATHEMATICA,
    TOOL_MULTISIM,
    TOOL_PROTEUS,
    TOOL_CAD,
    TOOL_SOLIDWORKS,
    TOOL_PHOTOSHOP,
    TOOL_ILLUSTRATOR,
    TOOL_TEXSTUDIO,
    TOOL_TEXWORKS,
];

/// 打开外部下载链接的官方域名白名单（仅 https）。
pub const ALLOWED_DOWNLOAD_DOMAINS: &[&str] = &[
    "code.visualstudio.com",
    "www.jetbrains.com",
    "www.jetbrains.com.cn",
    "cursor.com",
    "www.cursor.com",
    "obsidian.md",
    "typora.io",
];

/// URL 白名单校验：仅 https 且域名命中白名单（含其子域名）。
pub fn is_allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("").to_lowercase();
    ALLOWED_DOWNLOAD_DOMAINS
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

/// 项目类型 → 默认 IDE 候选顺序（`auto` 模式）。
pub fn ide_candidates_for(kind: ProjectKind) -> &'static [&'static str] {
    match kind {
        ProjectKind::Rust => &[TOOL_RUSTROVER, TOOL_VSCODE],
        ProjectKind::Java => &[TOOL_IDEA, TOOL_VSCODE],
        ProjectKind::Python => &[TOOL_PYCHARM, TOOL_VSCODE],
        ProjectKind::Node => &[TOOL_VSCODE, TOOL_CURSOR],
        ProjectKind::CSharp => &[TOOL_VSCODE, TOOL_IDEA],
        ProjectKind::Go => &[TOOL_GOLAND, TOOL_VSCODE],
        ProjectKind::Unity => &[TOOL_UNITY_HUB, TOOL_UNITY_EDITOR],
        ProjectKind::Generic => &[TOOL_VSCODE],
    }
}

/// 文件扩展名（小写、不含点）→ 工具候选；未映射返回空（走系统默认）。
pub fn tool_candidates_for_extension(ext: &str) -> &'static [&'static str] {
    match ext {
        "md" => &[TOOL_TYPORA, TOOL_OBSIDIAN],
        "ipynb" => &[TOOL_JUPYTER],
        "m" | "mat" | "fig" | "mlx" => &[TOOL_MATLAB],
        "opju" | "opj" => &[TOOL_ORIGIN],
        "nb" | "wl" => &[TOOL_MATHEMATICA],
        "ms12" | "ms13" | "ms14" | "ms15" => &[TOOL_MULTISIM],
        "pdsprj" | "pdsch" | "pdsasm" => &[TOOL_PROTEUS],
        "dwg" | "dxf" => &[TOOL_CAD],
        "sldprt" | "sldasm" | "slddrw" => &[TOOL_SOLIDWORKS],
        "psd" => &[TOOL_PHOTOSHOP],
        "ai" => &[TOOL_ILLUSTRATOR],
        "tex" => &[TOOL_TEXSTUDIO, TOOL_TEXWORKS],
        _ => &[],
    }
}

/// Obsidian vault 判定：目录含 `.obsidian`。
pub fn is_obsidian_vault(dir: &std::path::Path) -> bool {
    dir.join(".obsidian").is_dir()
}

/// 提取文件扩展名（小写、不含点）；隐藏文件/无扩展名返回 None。
pub fn extension_of(name: &str) -> Option<String> {
    let file_name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    if file_name.starts_with('.') {
        return None;
    }
    let ext = file_name.rsplit('.').next()?;
    if ext.is_empty() || ext == file_name {
        return None;
    }
    Some(ext.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ide_candidates_cover_all_kinds() {
        for kind in [
            ProjectKind::Rust,
            ProjectKind::Node,
            ProjectKind::Python,
            ProjectKind::Java,
            ProjectKind::CSharp,
            ProjectKind::Go,
            ProjectKind::Unity,
            ProjectKind::Generic,
        ] {
            assert!(!ide_candidates_for(kind).is_empty());
        }
    }

    #[test]
    fn extension_matrix() {
        assert_eq!(
            tool_candidates_for_extension("md"),
            &[TOOL_TYPORA, TOOL_OBSIDIAN]
        );
        assert_eq!(tool_candidates_for_extension("ipynb"), &[TOOL_JUPYTER]);
        assert_eq!(tool_candidates_for_extension("m"), &[TOOL_MATLAB]);
        assert_eq!(tool_candidates_for_extension("opju"), &[TOOL_ORIGIN]);
        assert_eq!(tool_candidates_for_extension("nb"), &[TOOL_MATHEMATICA]);
        assert_eq!(tool_candidates_for_extension("ms14"), &[TOOL_MULTISIM]);
        assert_eq!(tool_candidates_for_extension("pdsprj"), &[TOOL_PROTEUS]);
        assert_eq!(tool_candidates_for_extension("dwg"), &[TOOL_CAD]);
        assert_eq!(tool_candidates_for_extension("sldprt"), &[TOOL_SOLIDWORKS]);
        assert_eq!(tool_candidates_for_extension("psd"), &[TOOL_PHOTOSHOP]);
        assert_eq!(tool_candidates_for_extension("ai"), &[TOOL_ILLUSTRATOR]);
        assert_eq!(
            tool_candidates_for_extension("tex"),
            &[TOOL_TEXSTUDIO, TOOL_TEXWORKS]
        );
    }

    #[test]
    fn unmapped_extensions_fall_back_to_default() {
        assert!(tool_candidates_for_extension("docx").is_empty());
        assert!(tool_candidates_for_extension("pdf").is_empty());
        assert!(tool_candidates_for_extension("txt").is_empty());
    }

    #[test]
    fn extension_parsing_boundaries() {
        assert_eq!(extension_of("a.tar.gz"), Some("gz".to_string()));
        assert_eq!(extension_of("notes"), None);
        assert_eq!(extension_of(".hidden"), None);
        assert_eq!(extension_of("C:/dir/File.PDF"), Some("pdf".to_string()));
        assert_eq!(extension_of("dir/"), None);
    }

    #[test]
    fn obsidian_vault_detection() {
        let dir = std::env::temp_dir().join("rootup_tools_obsidian");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".obsidian")).unwrap();
        assert!(is_obsidian_vault(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn allowed_url_whitelist() {
        assert!(is_allowed_url("https://code.visualstudio.com/download"));
        assert!(is_allowed_url("https://www.jetbrains.com/idea/"));
        assert!(is_allowed_url("https://www.jetbrains.com.cn/pycharm/"));
        assert!(is_allowed_url("https://cursor.com/"));
        assert!(is_allowed_url("https://obsidian.md/download"));
        assert!(is_allowed_url("https://typora.io/"));
    }

    #[test]
    fn disallowed_urls_rejected() {
        assert!(!is_allowed_url("http://code.visualstudio.com"));
        assert!(!is_allowed_url("https://evil.example.com"));
        assert!(!is_allowed_url("https://example.com"));
        assert!(!is_allowed_url("ftp://code.visualstudio.com/x"));
        assert!(!is_allowed_url("javascript:alert(1)"));
        assert!(!is_allowed_url("https://code.visualstudio.com.evil.com/"));
    }
}
