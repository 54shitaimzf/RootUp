# RootUp

## 中文

RootUp 是一个使用 Rust + Slint 开发的桌面工具，面向学生场景，目标是帮助管理下载文件并提供更清晰的本地文件整理体验。

### 当前能力

- 图形界面主窗口（Slint）
- 系统托盘驻留与菜单（打开 / 退出）
- 关闭窗口时可选择最小化到托盘或直接退出
- 统一资源路径管理（图标、配置与数据目录）

### 快速开始

1. 安装 Rust（建议 stable）
2. 克隆仓库并进入项目目录
3. 运行：

```bash
cargo run
```

4. 发布构建：

```bash
cargo build --release
```

### 项目结构（简要）

- `src/`：核心 Rust 代码
- `ui/`：Slint 界面定义
- `resources/`：图标、配置、数据与字体资源

### 许可证

本项目使用 **GNU AGPLv3**，详见 `LICENSE`。

---

## English

RootUp is a desktop utility built with Rust + Slint. It targets student workflows and aims to improve local download/file organization with a lightweight UI experience.

### Current Features

- Main GUI window powered by Slint
- System tray integration with menu actions (Open / Quit)
- Close confirmation: minimize to tray or exit directly
- Centralized resource path management (icons, config, data)

### Quick Start

1. Install Rust (stable recommended)
2. Clone this repository and enter the project folder
3. Run:

```bash
cargo run
```

4. Build release:

```bash
cargo build --release
```

### Project Layout (Brief)

- `src/`: core Rust code
- `ui/`: Slint UI definitions
- `resources/`: icons, configs, data, and fonts

### License

This project is licensed under **GNU AGPLv3**. See `LICENSE` for details.
