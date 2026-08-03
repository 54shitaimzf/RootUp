//! 项目识别：特征文件 → 项目类型；向上找项目根；监控目录项目发现。
//!
//! AI 预留：`ProjectDetector` trait 是唯一识别入口，未来 AI 识别作为新实现
//! 插入（可先特征后 AI 增强），调用方无感。
use crate::core::path::{normalize_path, path_key};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 向上查找项目根的最大层数（文件 → 项目根）。
pub const MAX_PROJECT_DEPTH: usize = 5;

/// 项目类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Rust,
    Node,
    Python,
    Java,
    CSharp,
    Go,
    Unity,
    Generic,
}

impl ProjectKind {
    /// 小写 key（前端映射与日志使用）。
    pub fn key(self) -> &'static str {
        match self {
            ProjectKind::Rust => "rust",
            ProjectKind::Node => "node",
            ProjectKind::Python => "python",
            ProjectKind::Java => "java",
            ProjectKind::CSharp => "csharp",
            ProjectKind::Go => "go",
            ProjectKind::Unity => "unity",
            ProjectKind::Generic => "generic",
        }
    }
}

/// 项目信息（前端列表与快捷方式共用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub kind: ProjectKind,
}

/// 项目识别接口（AI 后续 = 新实现插入）。
pub trait ProjectDetector {
    fn detect(&self, dir: &Path) -> Option<ProjectKind>;
}

/// 内置特征文件探测。
pub struct FeatureDetector;

impl ProjectDetector for FeatureDetector {
    fn detect(&self, dir: &Path) -> Option<ProjectKind> {
        detect_project_kind(dir)
    }
}

fn has_any_file(dir: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| dir.join(name).is_file())
}

fn has_any_ext(dir: &Path, exts: &[&str]) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        if !path.is_file() {
            return false;
        }
        let Some(ext) = path.extension() else {
            return false;
        };
        let ext = ext.to_string_lossy().to_lowercase();
        exts.iter().any(|e| ext == *e)
    })
}

/// 特征文件探测（优先级：Unity → Rust → Go → Java → C# → Node → Python）。
pub fn detect_project_kind(dir: &Path) -> Option<ProjectKind> {
    if dir
        .join("ProjectSettings")
        .join("ProjectVersion.txt")
        .is_file()
    {
        return Some(ProjectKind::Unity);
    }
    if dir.join("Cargo.toml").is_file() {
        return Some(ProjectKind::Rust);
    }
    if dir.join("go.mod").is_file() {
        return Some(ProjectKind::Go);
    }
    if has_any_file(dir, &["pom.xml", "build.gradle", "settings.gradle"]) {
        return Some(ProjectKind::Java);
    }
    if has_any_ext(dir, &["sln", "csproj"]) {
        return Some(ProjectKind::CSharp);
    }
    if dir.join("package.json").is_file() {
        return Some(ProjectKind::Node);
    }
    if has_any_file(dir, &["pyproject.toml", "requirements.txt", "setup.py"]) {
        return Some(ProjectKind::Python);
    }
    None
}

fn project_info(dir: &Path, kind: ProjectKind) -> ProjectInfo {
    let normalized = normalize_path(&dir.to_string_lossy());
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| normalized.clone());
    ProjectInfo {
        path: normalized,
        name,
        kind,
    }
}

/// 从任意文件/目录向上找最近项目根（最多 `max_depth` 层）。
pub fn find_project_root(
    start: &Path,
    max_depth: usize,
    detector: &dyn ProjectDetector,
) -> Option<ProjectInfo> {
    let mut dir = if start.is_file() {
        start.parent()?
    } else {
        start
    };
    for _ in 0..=max_depth {
        if let Some(kind) = detector.detect(dir) {
            return Some(project_info(dir, kind));
        }
        dir = dir.parent()?;
    }
    None
}

/// 自动发现时跳过的噪音目录（固定集合）。
pub const NOISE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "__pycache__",
    "dist",
    "build",
    ".idea",
    ".vscode",
    ".vs",
    "out",
];

/// 发现项目：manual 目录自身 + watched 直接子目录；去重、按名称排序。
pub fn discover_projects(
    watched: &[String],
    manual: &[String],
    detector: &dyn ProjectDetector,
) -> Vec<ProjectInfo> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<ProjectInfo> = Vec::new();

    let mut push = |dir: &Path, kind: Option<ProjectKind>| {
        let kind = kind.unwrap_or(ProjectKind::Generic);
        let key = path_key(&normalize_path(&dir.to_string_lossy()));
        if seen.insert(key) {
            out.push(project_info(dir, kind));
        }
    };

    for dir in manual {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            push(&path, detector.detect(&path));
        }
    }

    for watched_dir in watched {
        let root = PathBuf::from(watched_dir);
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || NOISE_DIRS.contains(&name.as_str()) {
                continue;
            }
            if let Some(kind) = detector.detect(&path) {
                push(&path, Some(kind));
            }
        }
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_project_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn feature_matrix_covers_all_kinds() {
        let cases: &[(&str, ProjectKind)] = &[
            ("Cargo.toml", ProjectKind::Rust),
            ("package.json", ProjectKind::Node),
            ("pyproject.toml", ProjectKind::Python),
            ("requirements.txt", ProjectKind::Python),
            ("setup.py", ProjectKind::Python),
            ("pom.xml", ProjectKind::Java),
            ("build.gradle", ProjectKind::Java),
            ("go.mod", ProjectKind::Go),
            ("app.sln", ProjectKind::CSharp),
            ("app.csproj", ProjectKind::CSharp),
        ];
        for (file, kind) in cases {
            let dir = temp_dir(file.replace('.', "_").as_str());
            fs::write(dir.join(file), "x").unwrap();
            assert_eq!(detect_project_kind(&dir), Some(*kind), "file={file}");
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn unity_priority_over_others() {
        let dir = temp_dir("unity_priority");
        fs::create_dir_all(dir.join("ProjectSettings")).unwrap();
        fs::write(dir.join("ProjectSettings").join("ProjectVersion.txt"), "x").unwrap();
        fs::write(dir.join("Cargo.toml"), "x").unwrap();
        assert_eq!(detect_project_kind(&dir), Some(ProjectKind::Unity));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rust_priority_over_node() {
        let dir = temp_dir("rust_priority");
        fs::write(dir.join("Cargo.toml"), "x").unwrap();
        fs::write(dir.join("package.json"), "x").unwrap();
        assert_eq!(detect_project_kind(&dir), Some(ProjectKind::Rust));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_and_noise_dirs_yield_none() {
        let dir = temp_dir("empty");
        assert_eq!(detect_project_kind(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_root_from_file_and_parents() {
        let root = temp_dir("find_root");
        fs::write(root.join("Cargo.toml"), "x").unwrap();
        let nested = root.join("src").join("deep");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("main.rs");
        fs::write(&file, "x").unwrap();

        let detector = FeatureDetector;
        let found = find_project_root(&file, MAX_PROJECT_DEPTH, &detector).unwrap();
        assert_eq!(found.kind, ProjectKind::Rust);
        assert!(found.path.contains("find_root"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn find_root_respects_max_depth() {
        let root = temp_dir("find_depth");
        fs::write(root.join("Cargo.toml"), "x").unwrap();
        let mut deep = root.clone();
        for i in 0..8 {
            deep = deep.join(format!("d{i}"));
        }
        fs::create_dir_all(&deep).unwrap();
        let file = deep.join("f.txt");
        fs::write(&file, "x").unwrap();
        let detector = FeatureDetector;
        assert!(find_project_root(&file, 3, &detector).is_none());
        assert!(find_project_root(&file, 8, &detector).is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn discover_skips_noise_and_manual_generic() {
        let root = temp_dir("discover");
        fs::create_dir_all(root.join("proj-a")).unwrap();
        fs::write(root.join("proj-a").join("Cargo.toml"), "x").unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules").join("package.json"), "x").unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join(".hidden").join("go.mod"), "x").unwrap();
        fs::create_dir_all(root.join("notes")).unwrap();

        let manual = vec![root.join("notes").to_string_lossy().to_string()];
        let watched = vec![root.to_string_lossy().to_string()];
        let detector = FeatureDetector;
        let projects = discover_projects(&watched, &manual, &detector);
        let keys: Vec<&str> = projects.iter().map(|p| p.kind.key()).collect();
        assert_eq!(keys, vec!["generic", "rust"]);
        assert_eq!(projects[0].name, "notes");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn discover_deduplicates_manual_and_watched() {
        let root = temp_dir("dedupe");
        fs::write(root.join("Cargo.toml"), "x").unwrap();
        let watched = vec![root.to_string_lossy().to_string()];
        let manual = vec![root.to_string_lossy().to_string()];
        let detector = FeatureDetector;
        let projects = discover_projects(&watched, &manual, &detector);
        assert_eq!(projects.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }
}
