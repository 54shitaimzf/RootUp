# RootUp

[![CI](https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml/badge.svg)](https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml)

## 中文

RootUp 是一款面向学生场景的智能自动化文件整理与分类桌面工具：自动分类、一键归档，把碎片化的整理行为沉淀为可复用的规则资产，让文件"随下随理、随找随到"。

### 当前能力（v0.6.0）

- Tauri v2 + React 桌面应用框架
- 系统托盘驻留（打开 / 退出）
- 关闭窗口时确认：后台运行（销毁窗口、后台零浏览器内存）或退出程序
- 单实例运行，二次启动自动唤起已有窗口
- 主题：浅色 / 深色 / 跟随系统
- 界面语言：中文 / English，可随时切换
- 设置持久化，重启后保留
- 文件监听与索引：监控目录全量扫描、实时索引、快照差集与误删防护
- 自动分类标签：文档/图片/视频/音频/压缩包/代码/安装包/数据（扩展名映射，接口可扩展）
- 搜索为核心：输入自动补全类别/状态/标签，问号内提供完整语法说明；筛选 chips 按使用频率排序
- 可配置规则：忽略规则与分类映射各自独立弹窗编辑，附默认/编程开发/素材创作三套模板，支持保存为自定义方案随时套用（重启生效）
- 项目识别与智能打开：自动识别 Rust/Node/Python/Java/C#/Go/Unity 项目，自动发现 IDE 与常用工具（VS Code/Cursor/JetBrains/MATLAB/Typora/Obsidian 等），文件行一键打开/定位/用 IDE 打开，桌面快捷方式双击唤起 RootUp 打开项目
- 新手引导与帮助中心：首次启动欢迎弹窗、侧栏全局帮助入口（新手入门 / 搜索与高级用法）、IDE 选择与官方下载指导、检测到代码项目但无 IDE 时按需引导
- 首个公开发布：NSIS 安装包（per-user、免管理员、中英语言选择）、品牌图标全套、安装包自动验证

### 搜索语法

搜索框是文件页的核心入口：输入文字按文件名/路径查找，输入特殊语法按条件筛选；输入时自动补全，也可直接点击下方筛选 chips（按使用频率排序）。完整语法说明见搜索框右侧的问号。

- `type:pdf` — 按扩展名筛选
- `label:document` — 按分类标签筛选
- `state:pending` — 按状态筛选
- `size:>10MB` — 按大小筛选
- `before:2026-08-01` — 按修改时间筛选
- 可组合使用，如 `type:pdf 高数`

### 规划能力

文件监听、智能分类、课程表记录、作业管理与临期提醒、快捷路径等，详见 [docs/ROADMAP.md](docs/ROADMAP.md)、[docs/VISION.md](docs/VISION.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 技术栈

- 桌面壳：Tauri v2（Rust）
- 前端：React + TypeScript + Vite + Tailwind CSS
- 图标：lucide-react
- 国际化：i18next

### 质量检查

- 前端测试：`npm test`（纯函数 + 组件交互，约 119 用例）
- 架构依赖校验：`npm run check:arch`（单向依赖防回归）
- Rust 全量：`cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`
- 日志驱动冒烟：`scripts/smoke.ps1`（需先 `npm run tauri build -- --no-bundle`）
- 安装包验证：`scripts/verify-installer.ps1 -InstallerPath <nsis-setup.exe>`（静默安装 → 冒烟 → 卸载）

### 安装与发布

- 从 GitHub Releases 下载 `*-setup.exe`（NSIS，per-user 安装，无需管理员权限，安装时可选择中文或 English）。
- 安装包未做数字签名，Windows SmartScreen 首次运行会提示“未知发布者”，选择“仍要运行”即可；功能不受影响。
- 需要 WebView2 运行时（Windows 10/11 一般已内置）；缺失时安装器会引导下载。

### 快速开始

1. 安装 Rust（建议 stable）与 Node.js（建议 20+）
2. 克隆仓库并进入项目目录
3. 安装前端依赖：`npm install`
4. 开发运行：`npm run tauri dev`
5. 发布构建：`npm run tauri build`
> 注意：发布构建必须使用 `npm run tauri build`。直接运行 `cargo build --release` 不会把前端资源嵌入程序，窗口会显示 `localhost 拒绝连接`。

### 项目结构（简要）

- `src/`：React 前端（页面、组件、主题、i18n）
- `src-tauri/`：Rust 桌面壳（commands / core / infra 分层）
- `docs/`：项目文档（愿景、路线图、架构）
- `resources/`：图标等非代码资源

架构与依赖规则详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 开发者

- 余烬

### 许可证

本项目使用 **GNU GPLv3**，详见 `LICENSE`。

---

## English

RootUp is a smart file-organizing desktop app built for students. It auto-sorts downloads, archives files with one click, and turns scattered cleanup habits into reusable rules.

### Current Features (v0.6.0)

- Tauri v2 + React desktop app framework
- System tray with Open / Quit actions
- Close confirmation: run in background (destroy window, zero background memory) or quit
- Single-instance guard
- Theme: Light / Dark / Follow system
- UI language: 中文 / English, switchable anytime
- Persistent settings across restarts
- File watching & indexing: full scan of watched folders, real-time indexing, snapshot diff with accidental-deletion protection
- Auto category labels: Documents / Images / Videos / Audio / Archives / Code / Installers / Data (extension mapping, pluggable interface)
- Search syntax: `type:` / `label:` / `state:` / `size:` / `before:` / `after:` combined with plain text
- Configurable rules: ignore rules and classification mapping with three presets (default / developer / creative); takes effect after restart

### Search Syntax

- `type:pdf` — filter by extension
- `label:document` — filter by category label
- `state:pending` — filter by state
- `size:>10MB` — filter by size
- `before:2026-08-01` — filter by modified date
- Combine conditions, e.g. `type:pdf notes`

### Planned Features

File watching, smart classification, course schedules, homework management and deadline reminders. See [docs/ROADMAP.md](docs/ROADMAP.md), [docs/VISION.md](docs/VISION.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Tech Stack

- Desktop shell: Tauri v2 (Rust)
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Icons: lucide-react
- i18n: i18next

### Quick Start

1. Install Rust (stable recommended) and Node.js (20+ recommended)
2. Clone the repository and enter the project directory
3. Install frontend dependencies: `npm install`
4. Run in development: `npm run tauri dev`
5. Build for release: `npm run tauri build`
> Note: release builds must use `npm run tauri build`. Running `cargo build --release` directly does not embed the frontend assets, and the window will show `localhost connection refused`.

### Project Layout (Brief)

- `src/`: React frontend (pages, components, theme, i18n)
- `src-tauri/`: Rust desktop shell (commands / core / infra layers)
- `docs/`: project documents (vision, roadmap, architecture)
- `resources/`: non-code assets such as icons

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture and dependency rules.

### Developer

- Yujin (余烬)

### License

This project is licensed under **GNU GPLv3**. See `LICENSE` for details.
