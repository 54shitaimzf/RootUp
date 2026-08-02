# RootUp

[![CI](https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml/badge.svg)](https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml)

## 中文

RootUp 是一款面向学生场景的智能自动化文件整理与分类桌面工具：自动分类、一键归档，把碎片化的整理行为沉淀为可复用的规则资产，让文件"随下随理、随找随到"。

### 当前能力（v0.1.0）

- Tauri v2 + React 桌面应用框架
- 系统托盘驻留（打开 / 退出）
- 关闭窗口时确认：后台运行（销毁窗口、后台零浏览器内存）或退出程序
- 单实例运行，二次启动自动唤起已有窗口
- 主题：浅色 / 深色 / 跟随系统
- 界面语言：中文 / English，可随时切换
- 设置持久化，重启后保留

### 规划能力

文件监听、智能分类、课程表记录、作业管理与临期提醒、快捷路径等，详见 [docs/ROADMAP.md](docs/ROADMAP.md)、[docs/VISION.md](docs/VISION.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 技术栈

- 桌面壳：Tauri v2（Rust）
- 前端：React + TypeScript + Vite + Tailwind CSS
- 图标：lucide-react
- 国际化：i18next

### 快速开始

1. 安装 Rust（建议 stable）与 Node.js（建议 20+）
2. 克隆仓库并进入项目目录
3. 安装前端依赖：`npm install`
4. 开发运行：`npm run tauri dev`
5. 发布构建：`npm run tauri build`

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

### Current Features (v0.1.0)

- Tauri v2 + React desktop app framework
- System tray with Open / Quit actions
- Close confirmation: run in background (destroy window, zero background memory) or quit
- Single-instance guard
- Theme: Light / Dark / Follow system
- UI language: 中文 / English, switchable anytime
- Persistent settings across restarts

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
