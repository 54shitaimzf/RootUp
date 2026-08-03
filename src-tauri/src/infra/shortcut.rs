//! 桌面快捷方式：目标指向 RootUp `--open-project <path>`（智能唤起）。
use crate::core::project::{ProjectInfo, ProjectKind};
use mslnk::{LinkFlags, ShellLink};
use std::fs;
use std::path::{Path, PathBuf};

/// 编译期内嵌的项目图标（随 exe 分发，运行时写入缓存目录供 .lnk 引用）。
const EMBEDDED_ICONS: &[(&str, &[u8])] = &[
    (
        "rust.ico",
        include_bytes!("../../../resources/icons/projects/rust.ico"),
    ),
    (
        "node.ico",
        include_bytes!("../../../resources/icons/projects/node.ico"),
    ),
    (
        "python.ico",
        include_bytes!("../../../resources/icons/projects/python.ico"),
    ),
    (
        "java.ico",
        include_bytes!("../../../resources/icons/projects/java.ico"),
    ),
    (
        "csharp.ico",
        include_bytes!("../../../resources/icons/projects/csharp.ico"),
    ),
    (
        "go.ico",
        include_bytes!("../../../resources/icons/projects/go.ico"),
    ),
    (
        "unity.ico",
        include_bytes!("../../../resources/icons/projects/unity.ico"),
    ),
    (
        "obsidian.ico",
        include_bytes!("../../../resources/icons/projects/obsidian.ico"),
    ),
    (
        "matlab.ico",
        include_bytes!("../../../resources/icons/projects/matlab.ico"),
    ),
    (
        "generic.ico",
        include_bytes!("../../../resources/icons/projects/generic.ico"),
    ),
];

pub fn shortcut_icon_name(kind: ProjectKind) -> &'static str {
    match kind {
        ProjectKind::Rust => "rust.ico",
        ProjectKind::Node => "node.ico",
        ProjectKind::Python => "python.ico",
        ProjectKind::Java => "java.ico",
        ProjectKind::CSharp => "csharp.ico",
        ProjectKind::Go => "go.ico",
        ProjectKind::Unity => "unity.ico",
        ProjectKind::Generic => "generic.ico",
    }
}

/// 把内嵌图标写入缓存目录（已存在则跳过）。
pub fn ensure_shortcut_icons(icon_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(icon_dir).map_err(|e| format!("创建图标目录失败: {e}"))?;
    for (name, data) in EMBEDDED_ICONS {
        let path = icon_dir.join(name);
        if !path.exists() {
            fs::write(&path, data).map_err(|e| format!("写入图标失败: {e}"))?;
        }
    }
    Ok(())
}

/// 清洗快捷方式名中的非法文件名字符。
pub fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "项目".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 重名递增：`name.lnk` → `name (2).lnk` → ...
pub fn unique_shortcut_path(desktop_dir: &Path, name: &str) -> PathBuf {
    let mut candidate = desktop_dir.join(format!("{name}.lnk"));
    let mut index = 2;
    while candidate.exists() {
        candidate = desktop_dir.join(format!("{name} ({index}).lnk"));
        index += 1;
    }
    candidate
}

/// 创建项目快捷方式；返回生成的 .lnk 路径。
pub fn create_project_shortcut(
    project: &ProjectInfo,
    rootup_exe: &Path,
    desktop_dir: &Path,
    icon_dir: &Path,
) -> Result<PathBuf, String> {
    if !rootup_exe.is_file() {
        return Err("找不到 RootUp 程序文件".to_string());
    }
    if !desktop_dir.is_dir() {
        return Err("桌面目录不可用".to_string());
    }
    ensure_shortcut_icons(icon_dir)?;

    let name = sanitize_name(&project.name);
    let lnk_path = unique_shortcut_path(desktop_dir, &name);

    let mut link = ShellLink::new(rootup_exe).map_err(|e| format!("创建快捷方式失败: {e}"))?;
    link.set_arguments(Some(format!("--open-project \"{}\"", project.path)));
    link.set_icon_location(Some(
        icon_dir
            .join(shortcut_icon_name(project.kind))
            .to_string_lossy()
            .to_string(),
    ));
    link.header_mut()
        .update_link_flags(LinkFlags::HAS_ARGUMENTS, true);
    link.header_mut()
        .update_link_flags(LinkFlags::HAS_ICON_LOCATION, true);
    link.create_lnk(&lnk_path)
        .map_err(|e| format!("写入快捷方式失败: {e}"))?;
    Ok(lnk_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_shortcut_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_exe(dir: &Path) -> PathBuf {
        let exe = dir.join("rootup.exe");
        fs::write(&exe, "x").unwrap();
        exe
    }

    #[test]
    fn sanitize_replaces_invalid_chars() {
        assert_eq!(sanitize_name("a/b:c"), "a_b_c");
        assert_eq!(sanitize_name("   "), "项目");
        assert_eq!(sanitize_name("正常项目"), "正常项目");
    }

    #[test]
    fn unique_path_increments_on_conflict() {
        let root = temp_root("unique");
        fs::write(root.join("demo.lnk"), "x").unwrap();
        fs::write(root.join("demo (2).lnk"), "x").unwrap();
        let next = unique_shortcut_path(&root, "demo");
        assert_eq!(next.file_name().unwrap(), "demo (3).lnk");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn creates_lnk_with_icon_and_arguments() {
        let root = temp_root("create");
        let exe = fake_exe(&root);
        let desktop = root.join("desktop");
        let icons = root.join("icons");
        fs::create_dir_all(&desktop).unwrap();

        let project = ProjectInfo {
            path: "C:/proj/rust-app".into(),
            name: "rust-app".into(),
            kind: ProjectKind::Rust,
        };
        let result = create_project_shortcut(&project, &exe, &desktop, &icons);
        assert!(result.is_ok(), "{result:?}");
        let lnk = result.unwrap();
        assert_eq!(lnk.file_name().unwrap(), "rust-app.lnk");
        assert!(lnk.is_file());
        assert!(icons.join("rust.ico").is_file());
        assert!(icons.join("generic.ico").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_exe_is_rejected() {
        let root = temp_root("missing");
        let desktop = root.join("desktop");
        fs::create_dir_all(&desktop).unwrap();
        let project = ProjectInfo {
            path: "C:/proj/x".into(),
            name: "x".into(),
            kind: ProjectKind::Generic,
        };
        assert!(create_project_shortcut(
            &project,
            &root.join("nope.exe"),
            &desktop,
            &root.join("icons")
        )
        .is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
