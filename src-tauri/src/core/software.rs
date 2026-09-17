//! 软件单元识别（第一版，0.8.7 阶段三并入 0.8.8）。
//!
//! 识别口径：手动裁决（`software_dirs` ∪ 排除 `software_excluded`）优先，
//! 其次权威标记（PortableApps.com 结构 / Scoop 安装清单 / 便携启动器形态），
//! 最后结构启发式（exe 群聚目录）。纯逻辑层：目录探针以闭包注入，可测试。
use crate::core::path::{normalize_path, path_key};
use serde::Serialize;
use std::path::Path;

/// 识别依据（存 units.software_kind，前端展示与图标注册表共用）。
pub const DETECTED_MANUAL: &str = "manual";
pub const DETECTED_PAF: &str = "paf";
pub const DETECTED_SCOOP: &str = "scoop";
pub const DETECTED_PORTABLE: &str = "portable";
pub const DETECTED_HEURISTIC: &str = "heuristic";

/// 全部识别依据（顺序即展示优先级；键空间与前端图标注册表共享）。
#[cfg_attr(not(test), allow(dead_code))]
pub const DETECTED_BY_ALL: [&str; 5] = [
    DETECTED_MANUAL,
    DETECTED_PAF,
    DETECTED_SCOOP,
    DETECTED_PORTABLE,
    DETECTED_HEURISTIC,
];

/// 识别出的软件单元（目录级）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SoftwareInfo {
    pub path: String,
    pub name: String,
    /// manual | paf | scoop | portable | heuristic
    pub detected_by: String,
}

/// 目录探针：探目录的直接子项名（小写扩展名判定在内部完成）。
/// 注入实现可覆盖真实文件系统（生产）或内存清单（测试）。
pub trait DirProbe {
    /// 列出目录第一层的子项名（含扩展名，目录无扩展）。
    fn child_names(&self, dir: &str) -> Vec<String>;
    /// 子项是否为目录。
    fn is_dir(&self, dir: &str, child: &str) -> bool;
}

/// 真实文件系统探针。
pub struct FsProbe;

impl DirProbe for FsProbe {
    fn child_names(&self, dir: &str) -> Vec<String> {
        std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn is_dir(&self, dir: &str, child: &str) -> bool {
        Path::new(dir).join(child).is_dir()
    }
}

fn lower_ext(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn stem(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !ext.is_empty() && name.len() > ext.len() + 1 => stem,
        _ => name,
    }
}

/// 判定单个目录的识别依据；不命中返回 None。
///
/// 判定顺序（先权威后启发）：
/// 1. PAF：`App/AppInfo/appinfo.ini`（PortableApps.com 标准结构）；
/// 2. Scoop：`install.json` + `manifest.json`（Scoop 应用清单对）；
/// 3. 便携启动器：唯一 exe 且 stem 含 "portable"，或有 `Data` 目录伴随；
/// 4. 启发式：≥1 个 exe 且（exe ≥ 2 或含 dll）——排除项目噪音目录形态。
pub fn detect_software_dir(
    dir_name: &str,
    probe: &dyn DirProbe,
    path: &str,
) -> Option<&'static str> {
    let children = probe.child_names(path);
    if children.is_empty() {
        return None;
    }
    let has_child_dir = |name: &str| {
        children
            .iter()
            .any(|c| c.eq_ignore_ascii_case(name) && probe.is_dir(path, c))
    };
    let exes: Vec<&String> = children.iter().filter(|c| lower_ext(c) == "exe").collect();
    let has_portable_exe = exes
        .iter()
        .any(|e| stem(e).to_ascii_lowercase().contains("portable"));
    // PAF 标准结构：App 目录 + portable 命名的启动器（appinfo.ini 在 App/AppInfo/ 子层）
    if has_child_dir("App") && has_portable_exe {
        return Some(DETECTED_PAF);
    }
    // Scoop 安装清单对
    if children
        .iter()
        .any(|c| c.eq_ignore_ascii_case("install.json"))
        && children
            .iter()
            .any(|c| c.eq_ignore_ascii_case("manifest.json"))
    {
        return Some(DETECTED_SCOOP);
    }
    // 便携启动器：唯一 exe 且名字含 portable / 与目录同名，或有 Data 目录伴随
    if exes.len() == 1
        && (has_child_dir("Data") || {
            let exe_stem = stem(exes[0]).to_ascii_lowercase();
            exe_stem.contains("portable") || exe_stem == dir_name.to_ascii_lowercase()
        })
    {
        return Some(DETECTED_PORTABLE);
    }
    // 启发式：exe 群聚（≥2 exe，或 exe + dll 支撑结构）
    let has_dll = children.iter().any(|c| lower_ext(c) == "dll");
    if !exes.is_empty() && (exes.len() >= 2 || has_dll) {
        return Some(DETECTED_HEURISTIC);
    }
    None
}

/// 发现软件单元：监控目录直接子目录逐个判定 + 手动裁决并集 − 排除。
///
/// 与项目发现同构（直接子目录、不递归、按 path_key 去重排序）；
/// 项目噪音目录（node_modules / dist 等）不参与软件判定。
pub fn discover_software(
    watched: &[String],
    manual: &[String],
    excluded: &[String],
    probe: &dyn DirProbe,
) -> Vec<SoftwareInfo> {
    let excluded_keys: Vec<String> = excluded.iter().map(|d| path_key(d)).collect();
    let mut result: Vec<SoftwareInfo> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut push = |path: String, detected_by: &str, seen: &mut Vec<String>| {
        let key = path_key(&path);
        if seen.contains(&key) {
            return;
        }
        seen.push(key);
        let name = Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        result.push(SoftwareInfo {
            path,
            name,
            detected_by: detected_by.to_string(),
        });
    };
    // 手动裁决：排除优先级最高（先剔除再并入）
    for dir in manual {
        let dir = normalize_path(dir);
        if dir.is_empty() || excluded_keys.contains(&path_key(&dir)) {
            continue;
        }
        push(dir, DETECTED_MANUAL, &mut seen);
    }
    for root in watched {
        let root = normalize_path(root);
        for child in probe.child_names(&root) {
            if !probe.is_dir(&root, &child) {
                continue;
            }
            if crate::core::project::is_noise_dir_name(&child) {
                continue;
            }
            let path = normalize_path(&Path::new(&root).join(&child).to_string_lossy());
            if path.is_empty() || excluded_keys.contains(&path_key(&path)) {
                continue;
            }
            if let Some(detected_by) = detect_software_dir(&child, probe, &path) {
                push(path, detected_by, &mut seen);
            }
        }
    }
    result.sort_by_key(|a| a.name.to_lowercase());
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn detection_keys_match_icon_registry_fixture() {
        // 图标 key 注册表（fixtures/icon-keys.json）与 Rust 键空间同源断言
        let raw = include_str!("../../../fixtures/icon-keys.json");
        let value: serde_json::Value = serde_json::from_str(raw).expect("icon-keys.json 应可解析");
        let fixture_kinds: Vec<&str> = value["softwareKinds"]
            .as_array()
            .expect("softwareKinds 应为数组")
            .iter()
            .map(|v| v.as_str().expect("key 应为字符串"))
            .collect();
        assert_eq!(fixture_kinds, DETECTED_BY_ALL.to_vec());
        let unit_kinds: Vec<&str> = value["units"]
            .as_array()
            .expect("units 应为数组")
            .iter()
            .map(|v| v.as_str().expect("key 应为字符串"))
            .collect();
        assert_eq!(unit_kinds, vec!["file", "project", "software"]);
    }

    /// 内存探针：dir -> (child -> is_dir)。
    struct MemProbe(HashMap<String, Vec<(String, bool)>>);

    impl MemProbe {
        fn add_dir(&mut self, dir: &str, children: &[(&str, bool)]) {
            self.0.insert(
                dir.to_string(),
                children.iter().map(|(n, d)| (n.to_string(), *d)).collect(),
            );
        }
    }

    impl DirProbe for MemProbe {
        fn child_names(&self, dir: &str) -> Vec<String> {
            self.0
                .get(dir)
                .map(|c| c.iter().map(|(n, _)| n.clone()).collect())
                .unwrap_or_default()
        }
        fn is_dir(&self, dir: &str, child: &str) -> bool {
            self.0
                .get(dir)
                .and_then(|c| c.iter().find(|(n, _)| n == child))
                .map(|(_, d)| *d)
                .unwrap_or(false)
        }
    }

    fn probe_with(app_dir: &str, children: &[(&str, bool)]) -> MemProbe {
        let mut probe = MemProbe(HashMap::new());
        probe.add_dir(
            "C:/Watch",
            &[("SomeApp", true), ("Docs", true), ("notes.txt", false)],
        );
        probe.add_dir(app_dir, children);
        probe
    }

    #[test]
    fn detects_paf_structure() {
        let probe = probe_with(
            "C:/Watch/SomeApp",
            &[
                ("App", true),
                ("SomePortable.exe", false),
                ("Help.html", false),
            ],
        );
        assert_eq!(
            detect_software_dir("SomeApp", &probe, "C:/Watch/SomeApp"),
            Some(DETECTED_PAF)
        );
    }

    #[test]
    fn detects_scoop_manifest_pair() {
        let probe = probe_with(
            "C:/Watch/git",
            &[
                ("install.json", false),
                ("manifest.json", false),
                ("cmd", true),
            ],
        );
        assert_eq!(
            detect_software_dir("git", &probe, "C:/Watch/git"),
            Some(DETECTED_SCOOP)
        );
    }

    #[test]
    fn detects_portable_launcher() {
        // 唯一 exe + Data 目录
        let probe = probe_with("C:/Watch/tool", &[("tool.exe", false), ("Data", true)]);
        assert_eq!(
            detect_software_dir("tool", &probe, "C:/Watch/tool"),
            Some(DETECTED_PORTABLE)
        );
        // 唯一 exe 与目录同名（无 Data）
        let probe = probe_with(
            "C:/Watch/tool",
            &[("tool.exe", false), ("readme.txt", false)],
        );
        assert_eq!(
            detect_software_dir("tool", &probe, "C:/Watch/tool"),
            Some(DETECTED_PORTABLE)
        );
        // 多 exe + dll → heuristic
        let probe = probe_with(
            "C:/Watch/suite",
            &[("a.exe", false), ("b.exe", false), ("c.dll", false)],
        );
        assert_eq!(
            detect_software_dir("suite", &probe, "C:/Watch/suite"),
            Some(DETECTED_HEURISTIC)
        );
    }

    #[test]
    fn plain_dirs_are_not_software() {
        // 纯文档目录（无 exe）不命中
        let probe = probe_with("C:/Watch/Docs", &[("a.pdf", false), ("sub", true)]);
        assert_eq!(detect_software_dir("Docs", &probe, "C:/Watch/Docs"), None);
        // 单 exe 无支撑结构且名不含 portable / 不同名 → 不命中（宁缺勿滥）
        let probe = probe_with("C:/Watch/misc", &[("run.exe", false), ("a.txt", false)]);
        assert_eq!(detect_software_dir("misc", &probe, "C:/Watch/misc"), None);
    }

    #[test]
    fn discovery_merges_manual_and_respects_exclusion() {
        let mut probe = MemProbe(HashMap::new());
        probe.add_dir(
            "C:/Watch",
            &[
                ("SomeApp", true),
                ("Tools", true),
                ("Docs", true),
                ("node_modules", true),
            ],
        );
        probe.add_dir(
            "C:/Watch/SomeApp",
            &[("SomePortable.exe", false), ("App", true)],
        );
        probe.add_dir("C:/Watch/Tools", &[("t.exe", false), ("u.exe", false)]);
        let software = discover_software(
            &["C:/Watch".to_string()],
            &["C:/ManualApp".to_string()],
            &["C:/Watch/Tools".to_string()],
            &probe,
        );
        let paths: Vec<&str> = software.iter().map(|s| s.path.as_str()).collect();
        assert!(paths.contains(&"C:/Watch/SomeApp"), "{paths:?}");
        assert!(paths.contains(&"C:/ManualApp"), "手动裁决并入");
        assert!(!paths.contains(&"C:/Watch/Tools"), "排除压制启发式");
        assert!(!paths.contains(&"C:/Watch/Docs"), "非软件目录不进入");
        assert!(
            !paths.contains(&"C:/Watch/node_modules"),
            "项目噪音目录跳过"
        );
        let manual = software.iter().find(|s| s.path == "C:/ManualApp").unwrap();
        assert_eq!(manual.detected_by, DETECTED_MANUAL);
        // 排除也压制手动清单
        let excluded_both = discover_software(
            &["C:/Watch".to_string()],
            &["C:/X".to_string()],
            &["C:/X".to_string()],
            &probe,
        );
        assert!(!excluded_both.iter().any(|s| s.path == "C:/X"));
    }

    #[test]
    fn fs_probe_reads_real_dirs() {
        let dir = std::env::temp_dir().join(format!("rootup_sw_probe_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("app")).unwrap();
        std::fs::write(dir.join("app").join("app.exe"), "x").unwrap();
        std::fs::write(dir.join("app").join("data.txt"), "x").unwrap();
        let app = normalize_path(&dir.join("app").to_string_lossy());
        assert_eq!(
            detect_software_dir("app", &FsProbe, &app),
            Some(DETECTED_PORTABLE),
            "唯一 exe 与目录同名 → 便携形态"
        );
        let children = FsProbe.child_names(&app);
        assert!(children.iter().any(|c| c == "app.exe"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
