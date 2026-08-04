//! 应用查找与打开（成熟机制，参考 PowerToys Run）：
//! 自定义命令 → PATH 命令名 → Windows App Paths 注册表 → 内置常见路径（支持 `*` glob）→ 系统默认兜底。
use crate::core::settings::CustomOpenCommand;
use crate::core::tools;
use std::path::{Path, PathBuf};

/// 找到的应用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppCandidate {
    pub exe: PathBuf,
    pub args: Vec<String>,
    /// "custom" | "path" | "registry" | "builtin"
    pub source: &'static str,
}

/// 工具 → 候选定义（PATH 命令名 / App Paths 键 / 常见路径，路径可含环境变量与单段 `*`）。
pub struct ToolSpec {
    pub path_names: &'static [&'static str],
    pub app_paths: &'static [&'static str],
    pub common_paths: &'static [&'static str],
}

pub fn tool_spec(tool: &str) -> Option<&'static ToolSpec> {
    use tools::*;
    Some(match tool {
        TOOL_VSCODE => &ToolSpec {
            path_names: &["code"],
            app_paths: &["Code.exe"],
            common_paths: &["%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe"],
        },
        TOOL_CURSOR => &ToolSpec {
            path_names: &["cursor"],
            app_paths: &["Cursor.exe"],
            common_paths: &[
                "%LOCALAPPDATA%/Programs/cursor/Cursor.exe",
                "%LOCALAPPDATA%/Programs/Cursor/Cursor.exe",
            ],
        },
        TOOL_IDEA => &ToolSpec {
            path_names: &["idea"],
            app_paths: &["idea64.exe"],
            common_paths: &[
                "%LOCALAPPDATA%/Programs/IntelliJ IDEA Ultimate/bin/idea64.exe",
                "%LOCALAPPDATA%/Programs/IntelliJ IDEA Community Edition/bin/idea64.exe",
            ],
        },
        TOOL_PYCHARM => &ToolSpec {
            path_names: &["pycharm"],
            app_paths: &["pycharm64.exe"],
            common_paths: &[
                "%LOCALAPPDATA%/Programs/PyCharm Professional/bin/pycharm64.exe",
                "%LOCALAPPDATA%/Programs/PyCharm Community Edition/bin/pycharm64.exe",
            ],
        },
        TOOL_RUSTROVER => &ToolSpec {
            path_names: &["rustrover"],
            app_paths: &["rustrover64.exe"],
            common_paths: &["%LOCALAPPDATA%/Programs/RustRover/bin/rustrover64.exe"],
        },
        TOOL_GOLAND => &ToolSpec {
            path_names: &["goland"],
            app_paths: &["goland64.exe"],
            common_paths: &["%LOCALAPPDATA%/Programs/GoLand/bin/goland64.exe"],
        },
        TOOL_UNITY_HUB => &ToolSpec {
            path_names: &["unityhub"],
            app_paths: &["Unity Hub.exe"],
            common_paths: &[
                "%PROGRAMFILES%/Unity Hub/Unity Hub.exe",
                "%PROGRAMFILES(X86)%/Unity Hub/Unity Hub.exe",
            ],
        },
        TOOL_UNITY_EDITOR => &ToolSpec {
            path_names: &[],
            app_paths: &["Unity.exe"],
            common_paths: &[],
        },
        TOOL_TYPORA => &ToolSpec {
            path_names: &[],
            app_paths: &["Typora.exe"],
            common_paths: &[
                "%LOCALAPPDATA%/Programs/Typora/Typora.exe",
                "%LOCALAPPDATA%/Programs/typora/Typora.exe",
            ],
        },
        TOOL_OBSIDIAN => &ToolSpec {
            path_names: &[],
            app_paths: &["Obsidian.exe"],
            common_paths: &["%LOCALAPPDATA%/Programs/Obsidian/Obsidian.exe"],
        },
        TOOL_JUPYTER => &ToolSpec {
            path_names: &["jupyter"],
            app_paths: &[],
            common_paths: &[],
        },
        TOOL_MATLAB => &ToolSpec {
            path_names: &["matlab"],
            app_paths: &["matlab.exe"],
            common_paths: &["%PROGRAMFILES%/MATLAB/*/bin/matlab.exe"],
        },
        TOOL_ORIGIN => &ToolSpec {
            path_names: &["origin"],
            app_paths: &["Origin64.exe", "Origin.exe"],
            common_paths: &[
                "%PROGRAMFILES%/OriginLab/Origin*/Origin64.exe",
                "%PROGRAMFILES%/OriginLab/Origin*/Origin.exe",
            ],
        },
        TOOL_MATHEMATICA => &ToolSpec {
            path_names: &[],
            app_paths: &["Mathematica.exe"],
            common_paths: &[
                "%PROGRAMFILES%/Wolfram Research/Mathematica/*/Mathematica.exe",
                "%PROGRAMFILES(X86)%/Wolfram Research/Mathematica/*/Mathematica.exe",
            ],
        },
        TOOL_MULTISIM => &ToolSpec {
            path_names: &["multisim"],
            app_paths: &["multisim.exe"],
            common_paths: &[
                "%PROGRAMFILES(X86)%/National Instruments/Circuit Design Suite/*/multisim.exe",
            ],
        },
        TOOL_PROTEUS => &ToolSpec {
            path_names: &["proteus"],
            app_paths: &["Proteus.exe"],
            common_paths: &[
                "%PROGRAMFILES(X86)%/Labcenter Electronics/Proteus 8 Professional/Proteus.exe",
                "%PROGRAMFILES%/Labcenter Electronics/Proteus 8 Professional/Proteus.exe",
            ],
        },
        TOOL_CAD => &ToolSpec {
            path_names: &["acad", "zwcad"],
            app_paths: &["acad.exe", "ZWCAD.exe"],
            common_paths: &["%PROGRAMFILES%/Autodesk/AutoCAD */acad.exe"],
        },
        TOOL_SOLIDWORKS => &ToolSpec {
            path_names: &[],
            app_paths: &["SLDWORKS.exe"],
            common_paths: &["%PROGRAMFILES%/SOLIDWORKS Corp/SOLIDWORKS/*/SLDWORKS.exe"],
        },
        TOOL_PHOTOSHOP => &ToolSpec {
            path_names: &[],
            app_paths: &["Photoshop.exe"],
            common_paths: &["%PROGRAMFILES%/Adobe/Adobe Photoshop */Photoshop.exe"],
        },
        TOOL_ILLUSTRATOR => &ToolSpec {
            path_names: &[],
            app_paths: &["Illustrator.exe"],
            common_paths: &[
                "%PROGRAMFILES%/Adobe/Adobe Illustrator */Support Files/Contents/Windows/Illustrator.exe",
            ],
        },
        TOOL_TEXSTUDIO => &ToolSpec {
            path_names: &[],
            app_paths: &["texstudio.exe"],
            common_paths: &["%PROGRAMFILES%/texstudio/texstudio.exe"],
        },
        TOOL_TEXWORKS => &ToolSpec {
            path_names: &[],
            app_paths: &["TeXworks.exe"],
            common_paths: &[],
        },
        _ => return None,
    })
}

/// 环境抽象（测试注入 fake 实现）。
pub trait AppEnv {
    fn path_var(&self) -> String;
    fn app_paths_default(&self, exe: &str) -> Option<PathBuf>;
    fn expand(&self, path: &str) -> PathBuf;
    fn is_file(&self, path: &Path) -> bool;
}

/// 生产环境：真实 PATH / 注册表 / 文件系统。
pub struct SystemAppEnv;

impl AppEnv for SystemAppEnv {
    fn path_var(&self) -> String {
        std::env::var("PATH").unwrap_or_default()
    }

    fn app_paths_default(&self, exe: &str) -> Option<PathBuf> {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        let sub = format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
        for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            if let Ok(key) = RegKey::predef(root).open_subkey(&sub) {
                if let Ok(value) = key.get_value::<String, _>("") {
                    let value = value.trim_matches('"');
                    if !value.is_empty() {
                        return Some(PathBuf::from(value));
                    }
                }
            }
        }
        None
    }

    fn expand(&self, path: &str) -> PathBuf {
        expand_env(path)
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
}

fn expand_env(path: &str) -> PathBuf {
    let vars = [
        ("%LOCALAPPDATA%", "LOCALAPPDATA"),
        ("%APPDATA%", "APPDATA"),
        ("%PROGRAMFILES%", "ProgramFiles"),
        ("%PROGRAMFILES(X86)%", "ProgramFiles(x86)"),
        ("%USERPROFILE%", "USERPROFILE"),
    ];
    let mut out = path.to_string();
    for (token, var) in vars {
        if let Ok(value) = std::env::var(var) {
            out = out.replace(token, &value);
        }
    }
    PathBuf::from(out.replace('/', "\\"))
}

/// 按含 `*` 的路径模式查找第一个存在的文件（每段最多一个 `*`）。
fn resolve_glob(parts: &[&str], current: &Path, env: &dyn AppEnv) -> Option<PathBuf> {
    if parts.is_empty() {
        return env.is_file(current).then(|| current.to_path_buf());
    }
    // Windows 盘符段（如 "C:"）作为路径根处理
    if let Some(first) = parts.first() {
        if first.len() == 2 && first.ends_with(':') && current.as_os_str().is_empty() {
            let root = PathBuf::from(format!("{first}\\"));
            return resolve_glob(&parts[1..], &root, env);
        }
    }
    let (first, rest) = parts.split_first()?;
    if first.contains('*') {
        let entries = std::fs::read_dir(current).ok()?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if segment_matches(&name, first) {
                if let Some(found) = resolve_glob(rest, &entry.path(), env) {
                    return Some(found);
                }
            }
        }
        None
    } else {
        resolve_glob(rest, &current.join(first), env)
    }
}

fn split_path_parts(path: &str) -> Vec<&str> {
    path.split(['/', '\\']).filter(|p| !p.is_empty()).collect()
}

fn find_in_common(tool: &str, env: &dyn AppEnv) -> Option<PathBuf> {
    let spec = tool_spec(tool)?;
    for pattern in spec.common_paths {
        let expanded = env.expand(pattern);
        let expanded_str = expanded.to_string_lossy();
        let parts = split_path_parts(&expanded_str);
        if let Some(found) = resolve_glob(&parts, Path::new(""), env) {
            if env.is_file(&found) {
                return Some(found);
            }
        }
    }
    None
}

/// 按工具 key 查找应用（不构造参数）；找不到返回 None（调用方回退系统默认）。
pub fn find_app(
    tool: &str,
    custom: &[CustomOpenCommand],
    env: &dyn AppEnv,
) -> Option<AppCandidate> {
    // 1. 精确匹配的自定义命令（tool 字段 == 目标工具）
    for cmd in custom {
        if cmd.tool.trim() == tool && !cmd.command.trim().is_empty() {
            return Some(AppCandidate {
                exe: PathBuf::from(cmd.command.trim()),
                args: Vec::new(),
                source: "custom",
            });
        }
    }

    let spec = tool_spec(tool)?;
    // 2. PATH 命令名
    for name in spec.path_names {
        for dir in env.path_var().split(';').filter(|d| !d.is_empty()) {
            let base = PathBuf::from(dir);
            let mut candidate = base.join(name);
            if !env.is_file(&candidate) {
                candidate = base.join(format!("{name}.exe"));
            }
            if env.is_file(&candidate) {
                return Some(AppCandidate {
                    exe: candidate,
                    args: Vec::new(),
                    source: "path",
                });
            }
        }
    }
    // 3. App Paths 注册表
    for exe in spec.app_paths {
        if let Some(found) = env.app_paths_default(exe) {
            if env.is_file(&found) {
                return Some(AppCandidate {
                    exe: found,
                    args: Vec::new(),
                    source: "registry",
                });
            }
        }
    }
    // 4. 内置常见路径
    if let Some(found) = find_in_common(tool, env) {
        return Some(AppCandidate {
            exe: found,
            args: Vec::new(),
            source: "builtin",
        });
    }
    // 5. 通用自定义命令（tool 为空）最后兜底
    for cmd in custom {
        if cmd.tool.trim().is_empty() && !cmd.command.trim().is_empty() {
            return Some(AppCandidate {
                exe: PathBuf::from(cmd.command.trim()),
                args: Vec::new(),
                source: "custom",
            });
        }
    }
    None
}

/// 探测当前环境已安装的全部工具 key（按 TOOL_KEYS 顺序）。
pub fn detect_installed_tools(
    custom: &[CustomOpenCommand],
    env: &dyn AppEnv,
) -> Vec<&'static str> {
    tools::TOOL_KEYS
        .iter()
        .filter(|tool| find_app(tool, custom, env).is_some())
        .copied()
        .collect()
}

/// 路径段 glob 匹配：支持整段 `*` 或 `前缀*后缀`；无 `*` 时精确相等。
pub fn segment_matches(name: &str, pattern: &str) -> bool {
    if let Some((prefix, suffix)) = pattern.split_once('*') {
        name.starts_with(prefix) && name.ends_with(suffix)
    } else {
        name == pattern
    }
}

/// 按工具与目标路径构造打开参数。
pub fn build_open_args(tool: &str, target: &Path) -> Vec<String> {
    let target = target.to_string_lossy().to_string();
    match tool {
        tools::TOOL_JUPYTER => vec!["notebook".into(), target],
        tools::TOOL_MATLAB => {
            let dir = if Path::new(&target).is_dir() {
                target.clone()
            } else {
                Path::new(&target)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| target.clone())
            };
            vec!["-sd".into(), dir]
        }
        tools::TOOL_UNITY_HUB => {
            vec![
                "--".into(),
                "--headless".into(),
                "projects".into(),
                "-open".into(),
                target,
            ]
        }
        tools::TOOL_UNITY_EDITOR => vec!["-projectPath".into(), target],
        _ => vec![target],
    }
}

/// 进程启动抽象（生产 spawn 不等待，测试记录型）。
pub trait CommandRunner {
    fn run(&self, exe: &Path, args: &[String]) -> Result<(), String>;
}

pub struct SystemRunner;

impl CommandRunner for SystemRunner {
    fn run(&self, exe: &Path, args: &[String]) -> Result<(), String> {
        std::process::Command::new(exe)
            .args(args)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeEnv {
        path: String,
        registry: HashMap<String, PathBuf>,
        files: Vec<PathBuf>,
        vars: HashMap<String, String>,
    }

    impl FakeEnv {
        fn new() -> Self {
            Self {
                path: String::new(),
                registry: HashMap::new(),
                files: Vec::new(),
                vars: HashMap::new(),
            }
        }
        fn file(&mut self, path: PathBuf) {
            self.files.push(path);
        }
    }

    impl AppEnv for FakeEnv {
        fn path_var(&self) -> String {
            self.path.clone()
        }
        fn app_paths_default(&self, exe: &str) -> Option<PathBuf> {
            self.registry.get(exe).cloned()
        }
        fn expand(&self, path: &str) -> PathBuf {
            let mut out = path.to_string();
            for (token, value) in &self.vars {
                out = out.replace(token, value);
            }
            PathBuf::from(out.replace('/', "\\"))
        }
        fn is_file(&self, path: &Path) -> bool {
            let norm = |p: &Path| p.to_string_lossy().replace('\\', "/");
            let target = norm(path);
            self.files.iter().any(|f| norm(f) == target)
        }
    }

    #[test]
    fn path_lookup_uses_path_var() {
        let mut env = FakeEnv::new();
        let exe = PathBuf::from("C:/tools/code.exe");
        env.file(exe.clone());
        env.path = "C:/tools".into();
        let found = find_app(tools::TOOL_VSCODE, &[], &env).unwrap();
        assert_eq!(found.exe, exe);
        assert_eq!(found.source, "path");
    }

    #[test]
    fn registry_lookup_works() {
        let mut env = FakeEnv::new();
        let exe = PathBuf::from("C:/Program Files/Typora/Typora.exe");
        env.file(exe.clone());
        env.registry.insert("Typora.exe".into(), exe.clone());
        let found = find_app(tools::TOOL_TYPORA, &[], &env).unwrap();
        assert_eq!(found.exe, exe);
        assert_eq!(found.source, "registry");
    }

    #[test]
    fn builtin_fixed_path_lookup_works() {
        let mut env = FakeEnv::new();
        let exe = PathBuf::from("C:/Users/t/AppData/Local/Programs/Typora/Typora.exe");
        env.file(exe.clone());
        env.vars
            .insert("%LOCALAPPDATA%".into(), "C:/Users/t/AppData/Local".into());
        let found = find_app(tools::TOOL_TYPORA, &[], &env).unwrap();
        assert_eq!(found.exe, exe);
        assert_eq!(found.source, "builtin");
    }

    #[test]
    fn segment_glob_matching() {
        assert!(segment_matches("Origin2025", "Origin*"));
        assert!(segment_matches("MATLAB", "*"));
        assert!(segment_matches("R2024b", "R*b"));
        assert!(!segment_matches("Unity", "Origin*"));
        assert!(segment_matches("Code.exe", "Code.exe"));
        assert!(!segment_matches("code.exe", "Code.exe"));
    }

    #[test]
    fn custom_matching_tool_wins() {
        let mut env = FakeEnv::new();
        let custom_exe = PathBuf::from("D:/custom/zed.exe");
        env.file(custom_exe.clone());
        let custom = vec![CustomOpenCommand {
            name: "Zed".into(),
            command: "D:/custom/zed.exe".into(),
            tool: tools::TOOL_VSCODE.to_string(),
        }];
        let found = find_app(tools::TOOL_VSCODE, &custom, &env).unwrap();
        assert_eq!(found.exe, custom_exe);
        assert_eq!(found.source, "custom");
    }

    #[test]
    fn generic_custom_is_last_resort() {
        let env = FakeEnv::new();
        let custom = vec![CustomOpenCommand {
            name: "Notepad".into(),
            command: "C:/Windows/notepad.exe".into(),
            tool: String::new(),
        }];
        let found = find_app(tools::TOOL_TYPORA, &custom, &env).unwrap();
        assert_eq!(found.exe, PathBuf::from("C:/Windows/notepad.exe"));
    }

    #[test]
    fn unknown_tool_yields_none() {
        let env = FakeEnv::new();
        assert!(find_app("nonexistent", &[], &env).is_none());
    }

    #[test]
    fn detect_installed_tools_lists_matches() {
        let mut env = FakeEnv::new();
        env.path = "C:/tools".into();
        env.file(PathBuf::from("C:/tools/code.exe"));
        env.file(PathBuf::from("C:/tools/code"));
        env.registry
            .insert("Typora.exe".into(), PathBuf::from("C:/tools/Typora.exe"));
        env.file(PathBuf::from("C:/tools/Typora.exe"));
        let detected = detect_installed_tools(&[], &env);
        assert!(detected.contains(&tools::TOOL_VSCODE));
        assert!(detected.contains(&tools::TOOL_TYPORA));
        assert!(!detected.contains(&tools::TOOL_MATLAB));
    }

    #[test]
    fn detect_installed_tools_empty_env() {
        let env = FakeEnv::new();
        assert!(detect_installed_tools(&[], &env).is_empty());
    }

    #[test]
    fn open_args_construction() {
        assert_eq!(
            build_open_args(tools::TOOL_JUPYTER, Path::new("C:/n.ipynb")),
            vec!["notebook", "C:/n.ipynb"]
        );
        assert_eq!(
            build_open_args(tools::TOOL_MATLAB, Path::new("C:/proj/run.m")),
            vec!["-sd", "C:/proj"]
        );
        assert_eq!(
            build_open_args(tools::TOOL_UNITY_HUB, Path::new("C:/game")),
            vec!["--", "--headless", "projects", "-open", "C:/game"]
        );
        assert_eq!(
            build_open_args(tools::TOOL_VSCODE, Path::new("C:/proj")),
            vec!["C:/proj"]
        );
    }
}
