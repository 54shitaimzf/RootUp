use std::path::{Path, PathBuf};

/// AppPaths 负责统一管理应用运行时的路径。
///
/// # 示例
///
/// ```rust
/// let paths = AppPaths::discover();
/// let icon = paths.icon("RootUp_64x64.ico");
/// let config = paths.config("default.toml");
/// ```
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// 应用基础目录：发布模式下通常是 exe 所在目录，开发模式下是项目根目录。
    pub base_dir: PathBuf,
    /// 统一资源目录：默认约定为 `<base_dir>/resources`。
    pub resources_dir: PathBuf,
}

impl AppPaths {
    /// 自动发现路径根目录。
    ///
    /// 策略：
    /// 1. 先尝试发布目录（exe 同级 `resources`）
    /// 2. 若不存在则回退到开发目录（`CARGO_MANIFEST_DIR/resources`）
    pub fn discover() -> Self {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let resources_dir = exe_dir.join("resources");
                if resources_dir.exists() {
                    return Self {
                        base_dir: exe_dir.to_path_buf(),
                        resources_dir,
                    };
                }
            }
        }

        let base_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let resources_dir = base_dir.join("resources");
        Self {
            base_dir,
            resources_dir,
        }
    }

    /// 获取 `resources` 下的任意相对路径。
    ///
    /// # 示例
    ///
    /// ```rust
    /// let paths = AppPaths::discover();
    /// let p = paths.resource("icons/tray.ico");
    /// ```
    pub fn resource(&self, relative: impl AsRef<Path>) -> PathBuf {
        self.resources_dir.join(relative)
    }

    /// 获取图标文件路径：`resources/icons/<file_name>`。
    ///
    /// # 示例
    ///
    /// ```rust
    /// let paths = AppPaths::discover();
    /// let p = paths.icon("RootUp_64x64.ico");
    /// ```
    pub fn icon(&self, file_name: &str) -> PathBuf {
        self.resources_dir.join("icons").join(file_name)
    }

    /// 获取配置文件路径：`resources/config/<file_name>`。
    ///
    /// # 示例
    ///
    /// ```rust
    /// let paths = AppPaths::discover();
    /// let p = paths.config("app.toml");
    /// ```
    pub fn config(&self, file_name: &str) -> PathBuf {
        self.resources_dir.join("config").join(file_name)
    }

    /// 获取静态数据路径：`resources/data/<file_name>`。
    ///
    /// # 示例
    ///
    /// ```rust
    /// let paths = AppPaths::discover();
    /// let p = paths.data("rules.json");
    /// ```
    pub fn data(&self, file_name: &str) -> PathBuf {
        self.resources_dir.join("data").join(file_name)
    }
}
