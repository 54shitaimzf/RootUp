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
    Cpp,
    Php,
    Ruby,
    Dart,
    Flutter,
    Kotlin,
    Swift,
    Android,
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
            ProjectKind::Cpp => "cpp",
            ProjectKind::Php => "php",
            ProjectKind::Ruby => "ruby",
            ProjectKind::Dart => "dart",
            ProjectKind::Flutter => "flutter",
            ProjectKind::Kotlin => "kotlin",
            ProjectKind::Swift => "swift",
            ProjectKind::Android => "android",
            ProjectKind::Generic => "generic",
        }
    }
}

/// 项目来源：手动添加 / 监控目录自动发现。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectSource {
    Manual,
    Auto,
}

/// 项目信息（前端列表与快捷方式共用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub kind: ProjectKind,
    pub source: ProjectSource,
    pub detected_by: Option<String>,
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

fn find_first_file(dir: &Path, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find(|name| dir.join(name).is_file())
        .map(|name| (*name).to_string())
}

fn first_file_with_ext(dir: &Path, exts: &[&str]) -> Option<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    entries.flatten().find_map(|entry| {
        let path = entry.path();
        if !path.is_file() {
            return None;
        }
        let ext = path.extension()?.to_string_lossy().to_lowercase();
        if exts.contains(&ext.as_str()) {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

/// 特征文件探测（返回项目类型 + 命中特征文件名）。
/// 优先级：Unity → Flutter → Android → Kotlin → Rust → Go → Java → C# → Node →
/// Python → Cpp → PHP → Ruby → Dart → Swift。
pub fn detect_project_kind_with_feature(dir: &Path) -> Option<(ProjectKind, String)> {
    if dir
        .join("ProjectSettings")
        .join("ProjectVersion.txt")
        .is_file()
    {
        return Some((ProjectKind::Unity, "ProjectVersion.txt".into()));
    }
    if dir.join("pubspec.yaml").is_file() && dir.join("lib").join("main.dart").is_file() {
        return Some((ProjectKind::Flutter, "lib/main.dart".into()));
    }
    if dir.join("AndroidManifest.xml").is_file() {
        return Some((ProjectKind::Android, "AndroidManifest.xml".into()));
    }
    if dir.join("settings.gradle.kts").is_file() {
        return Some((ProjectKind::Kotlin, "settings.gradle.kts".into()));
    }
    if let Some(file) = first_file_with_ext(dir, &["kt"]) {
        return Some((ProjectKind::Kotlin, file));
    }
    if dir.join("Cargo.toml").is_file() {
        return Some((ProjectKind::Rust, "Cargo.toml".into()));
    }
    if dir.join("go.mod").is_file() {
        return Some((ProjectKind::Go, "go.mod".into()));
    }
    if let Some(file) = find_first_file(dir, &["pom.xml", "build.gradle", "settings.gradle"]) {
        return Some((ProjectKind::Java, file));
    }
    if let Some(file) = first_file_with_ext(dir, &["sln", "csproj"]) {
        return Some((ProjectKind::CSharp, file));
    }
    if dir.join("package.json").is_file() {
        return Some((ProjectKind::Node, "package.json".into()));
    }
    if let Some(file) = find_first_file(dir, &["pyproject.toml", "requirements.txt", "setup.py"]) {
        return Some((ProjectKind::Python, file));
    }
    if dir.join("CMakeLists.txt").is_file() {
        return Some((ProjectKind::Cpp, "CMakeLists.txt".into()));
    }
    if dir.join("composer.json").is_file() {
        return Some((ProjectKind::Php, "composer.json".into()));
    }
    if let Some(file) = first_file_with_ext(dir, &["php"]) {
        return Some((ProjectKind::Php, file));
    }
    if dir.join("Gemfile").is_file() {
        return Some((ProjectKind::Ruby, "Gemfile".into()));
    }
    if let Some(file) = first_file_with_ext(dir, &["rb"]) {
        return Some((ProjectKind::Ruby, file));
    }
    if dir.join("pubspec.yaml").is_file() {
        return Some((ProjectKind::Dart, "pubspec.yaml".into()));
    }
    if dir.join("Package.swift").is_file() {
        return Some((ProjectKind::Swift, "Package.swift".into()));
    }
    if let Some(file) = first_file_with_ext(dir, &["swift"]) {
        return Some((ProjectKind::Swift, file));
    }
    None
}

/// 特征文件探测（仅类型，供既有调用方使用）。
pub fn detect_project_kind(dir: &Path) -> Option<ProjectKind> {
    detect_project_kind_with_feature(dir).map(|(kind, _)| kind)
}

fn project_info(
    dir: &Path,
    kind: ProjectKind,
    source: ProjectSource,
    detected_by: Option<String>,
) -> ProjectInfo {
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
        source,
        detected_by,
    }
}

/// 目录名是否为噪音目录（自动发现与向上查找跳过）。
pub fn is_noise_dir_name(name: &str) -> bool {
    name.starts_with('.') || NOISE_DIRS.contains(&name)
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
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if is_noise_dir_name(&name) {
            dir = dir.parent()?;
            continue;
        }
        if let Some(kind) = detector.detect(dir) {
            let detected_by = detect_project_kind_with_feature(dir).map(|(_, feature)| feature);
            return Some(project_info(dir, kind, ProjectSource::Manual, detected_by));
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

    let mut push = |dir: &Path, source: ProjectSource| {
        let (kind, detected_by) = detect_project_kind_with_feature(dir)
            .map(|(kind, feature)| (kind, Some(feature)))
            .unwrap_or((ProjectKind::Generic, None));
        let key = path_key(&normalize_path(&dir.to_string_lossy()));
        if seen.insert(key) {
            out.push(project_info(dir, kind, source, detected_by));
        }
    };

    for dir in manual {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            push(&path, ProjectSource::Manual);
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
            if detector.detect(&path).is_some() {
                push(&path, ProjectSource::Auto);
            }
        }
    }

    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

/// 单元根 = 手动项目目录 + 监控目录中发现的直接子项目（规范化、去重）。
/// 单元根内部的单个文件不进文件页索引（扫描/监听跳过）。
pub fn managed_unit_roots(watched: &[String], manual: &[String]) -> Vec<String> {
    let detector = FeatureDetector;
    let mut roots: Vec<String> = discover_projects(watched, manual, &detector)
        .into_iter()
        .map(|p| normalize_path(&p.path))
        .collect();
    roots.extend(manual.iter().map(|d| normalize_path(d)));
    roots.sort();
    roots.dedup_by(|a, b| path_key(a) == path_key(b));
    roots
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
    fn project_kinds_match_fixture() {
        let raw = include_str!("../../../fixtures/app-contracts.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/app-contracts.json 应可解析");
        let fixture = value["projectKinds"].as_array().expect("projectKinds 应为数组");
        // 与 enum 全量 key 对齐：新增变体时必须同步 fixture
        let all = [
            ProjectKind::Rust,
            ProjectKind::Node,
            ProjectKind::Python,
            ProjectKind::Java,
            ProjectKind::CSharp,
            ProjectKind::Go,
            ProjectKind::Unity,
            ProjectKind::Cpp,
            ProjectKind::Php,
            ProjectKind::Ruby,
            ProjectKind::Dart,
            ProjectKind::Flutter,
            ProjectKind::Kotlin,
            ProjectKind::Swift,
            ProjectKind::Android,
            ProjectKind::Generic,
        ];
        assert_eq!(fixture.len(), all.len(), "项目类型数应与枚举一致");
        for kind in all {
            assert!(
                fixture.iter().any(|v| v.as_str() == Some(kind.key())),
                "fixture 缺少项目类型 {}",
                kind.key()
            );
        }
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
            ("CMakeLists.txt", ProjectKind::Cpp),
            ("composer.json", ProjectKind::Php),
            ("main.php", ProjectKind::Php),
            ("Gemfile", ProjectKind::Ruby),
            ("main.rb", ProjectKind::Ruby),
            ("pubspec.yaml", ProjectKind::Dart),
            ("settings.gradle.kts", ProjectKind::Kotlin),
            ("Main.kt", ProjectKind::Kotlin),
            ("Package.swift", ProjectKind::Swift),
            ("main.swift", ProjectKind::Swift),
            ("AndroidManifest.xml", ProjectKind::Android),
        ];
        for (file, kind) in cases {
            let dir = temp_dir(file.replace('.', "_").as_str());
            fs::write(dir.join(file), "x").unwrap();
            assert_eq!(detect_project_kind(&dir), Some(*kind), "file={file}");
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn flutter_wins_over_dart_and_android() {
        let dir = temp_dir("flutter_priority");
        fs::write(dir.join("pubspec.yaml"), "x").unwrap();
        fs::create_dir_all(dir.join("lib")).unwrap();
        fs::write(dir.join("lib").join("main.dart"), "x").unwrap();
        fs::create_dir_all(dir.join("android").join("app")).unwrap();
        fs::write(
            dir.join("android").join("app").join("AndroidManifest.xml"),
            "x",
        )
        .unwrap();
        assert_eq!(
            detect_project_kind_with_feature(&dir),
            Some((ProjectKind::Flutter, "lib/main.dart".into()))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn android_and_kotlin_beat_java() {
        let android = temp_dir("android_priority");
        fs::write(android.join("AndroidManifest.xml"), "x").unwrap();
        fs::write(android.join("build.gradle"), "x").unwrap();
        assert_eq!(
            detect_project_kind_with_feature(&android),
            Some((ProjectKind::Android, "AndroidManifest.xml".into()))
        );
        let _ = fs::remove_dir_all(&android);

        let kotlin = temp_dir("kotlin_priority");
        fs::write(kotlin.join("settings.gradle.kts"), "x").unwrap();
        fs::write(kotlin.join("build.gradle"), "x").unwrap();
        assert_eq!(
            detect_project_kind_with_feature(&kotlin),
            Some((ProjectKind::Kotlin, "settings.gradle.kts".into()))
        );
        let _ = fs::remove_dir_all(&kotlin);
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
    fn find_root_skips_noise_dirs_while_walking_up() {
        let root = temp_dir("find_noise");
        fs::write(root.join("Cargo.toml"), "x").unwrap();
        let noise = root.join("node_modules").join("pkg").join("src");
        fs::create_dir_all(&noise).unwrap();
        fs::write(noise.join("main.rs"), "x").unwrap();

        let detector = FeatureDetector;
        let found =
            find_project_root(&noise.join("main.rs"), MAX_PROJECT_DEPTH, &detector).unwrap();
        assert_eq!(found.kind, ProjectKind::Rust);
        assert_eq!(found.source, ProjectSource::Manual);
        assert_eq!(found.detected_by.as_deref(), Some("Cargo.toml"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn find_root_at_filesystem_root_returns_none() {
        let detector = FeatureDetector;
        assert!(find_project_root(std::path::Path::new("/"), 3, &detector).is_none());
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
        assert_eq!(projects[0].source, ProjectSource::Manual);
        assert_eq!(projects[0].detected_by, None);
        assert_eq!(projects[1].source, ProjectSource::Auto);
        assert_eq!(projects[1].detected_by.as_deref(), Some("Cargo.toml"));
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
