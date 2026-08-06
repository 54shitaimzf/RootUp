# RootUp

[![CI](https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml/badge.svg)](https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml)

## 中文

RootUp 是一款面向学生场景的智能自动化文件整理与分类桌面工具：自动分类、一键归档，把碎片化的整理行为沉淀为可复用的规则资产，让文件"随下随理、随找随到"。

### 当前能力（v0.8.3 已发布）

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
- 标签管理：自定义标签的显示名/图标/预设色板，内置大类只读，筛选与搜索统一显示
- 受控归档与撤销：单文件/批量/筛选结果归档、项目单元整体归档（桌面快捷方式自动联动）、自动归档开关（仅分类明确的新文件），全部可撤销
- 项目识别与智能打开：自动识别 Rust/Node/Python/Java/C#/Go/Unity/C++/PHP/Ruby/Dart/Flutter/Kotlin/Swift/Android 项目（卡片显示命中特征文件），自动发现 IDE 与常用工具（VS Code/Cursor/JetBrains/MATLAB/Typora/Obsidian 等），文件行一键打开/定位/用 IDE 打开，桌面快捷方式双击唤起 RootUp 打开项目
- 新手引导与帮助中心：首次启动欢迎弹窗、侧栏全局帮助入口（新手入门 / 搜索与高级用法）、IDE 选择与官方下载指导、检测到代码项目但无 IDE 时按需引导
- 首个公开发布：NSIS 安装包（per-user、免管理员、中英语言选择）、品牌图标全套、安装包自动验证
- 学业页（v0.8.0）：课程表（时间轴周视图、日期与“今天”标识、当前时间线、单双周 / 指定周次、周起始日切换、堆叠卡与铺开查看）与作业（截止排序、状态 / 课程筛选、短备注 + 可展开详情、逾期/剩余天数、标记完成确认、默认只看活跃）；学期即课表，支持新建/编辑/复制/删除，数据持久化到后端 `study.json`，课程名自动纳入文件分类标签；全应用按钮遵循 Windows“是左否右”
- 学业提醒与设置（v0.8.1）：作业截止提醒（默认关闭、可设提前量，学业页提示条 + 列表分组 + 托盘计数直达）；关闭默认行为持久化（每次询问 / 后台运行 / 退出）；语言下拉与 i18n 注册表；设置页按常规/监控与分类/归档/学业提醒/高级分组；托盘左键打开、动态菜单（临期作业直达、自动归档与主题快速切换）；桌面“打开未完成作业”快捷方式
- 监控体验与视觉（v0.8.2）：移除监控目录即清理索引（可重扫恢复）；原生“浏览…”目录选择器、文件夹拖拽、常用目录一键添加；动效令牌与全局“减少动画”降级、按钮微动、悬浮提示体系；设置项“点行看说明 / 编辑按钮才编辑”，说明中心新增“设置说明”分区
- 体验补课（v0.8.3）：自绘下拉与输入过滤（替换全部原生下拉）；项目页原生浏览/拖拽/常用目录/粘贴清洗，来源（手动/自动）与识别依据展示，向上查找跳过噪音目录；托盘多尺寸图标与临期/逾期红点角标；设置与帮助中心观感统一

### 搜索语法

搜索框是文件页的核心入口：输入文字按文件名/路径查找，输入特殊语法按条件筛选；输入时自动补全，也可直接点击下方筛选 chips（按使用频率排序）。完整语法说明见搜索框右侧的问号。

- `type:pdf` — 按扩展名筛选
- `label:document` — 按分类标签筛选
- `state:pending` — 按状态筛选
- `size:>10MB` — 按大小筛选
- `before:2026-08-01` — 按修改时间筛选
- 可组合使用，如 `type:pdf 高数`

### 规划能力

已固定版本规划：v0.8.4 存储与扫描地基（扫描器重构、SQLite 调优、启动与后台优化）、v0.8.5 快速扫描与查询、v0.8.6 规模与体积、v0.8.7 单元同构，后续至 v2.0 的完整路线见 [docs/ROADMAP.md](docs/ROADMAP.md)；架构与皮肤约定见 [docs/VISION.md](docs/VISION.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 技术栈

- 桌面壳：Tauri v2（Rust）
- 前端：React + TypeScript + Vite + Tailwind CSS
- 图标：lucide-react
- 国际化：i18next

### 质量检查

- 前端测试：`npm test`（纯函数 + 组件交互，394 用例）
- Rust 测试：`cargo test`（271 用例）
- 架构依赖校验：`npm run check:arch`（单向依赖防回归）
- Rust 全量：`cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`
- 日志驱动冒烟：`scripts/smoke.ps1`（需先 `npm run tauri build -- --no-bundle`）
- Agent 引导验收：`scripts/agent-acceptance.ps1`（真实夹具 + 带参启动 + 主窗口/托盘截图核对清单）
- 发布门禁（版本提交前强制）：`scripts/pre-release-check.ps1`（全部单测/构建/冒烟 + AI 真实全链路深链验收，需桌面会话与提权）
- 性能基准（自研唯一标准，仅本地运行）：`scripts/bench-all.ps1` 一键执行引擎（`-EngineOnly`）与系统（`-SystemOnly`）基准并渲染（README 对比表与 SVG 趋势图），0.8.3 官方基线含时间/空间/IO 共 50 项指标、churn VACUUM 硬断言；host 指纹扩展（OS/CPU/rustc/node/npm/RAM/commit），确定性语料自检，渲染器只对同指纹版本计算 delta 与 15% 警示；结果见 [benchmarks/README.md](benchmarks/README.md)

0.8.3 官方基线（引擎 Full + 系统 10k）关键值：

| 指标 | p50 |
|---|---|
| 冷启动 | 320.7 ms |
| 可交互耗时（冷） | 1944.8 ms |
| 全量扫描 10k | 361 ms（27700 files/s） |
| 空闲 RSS | 30.1 MB |
| 索引库体积（10k） | 7620.6 KB |
| 前端 JS gzip | 143.3 KB |
| 引擎扫描 10k（mixed） | 303.2 ms |
| 引擎扫描 100k（mixed） | 2821.6 ms |
| 标签重分类 100k | 152.0 ms |

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

### Current Features (v0.8.3 released)

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
- Label management: custom display names, icons and a preset palette for labels; built-in categories stay read-only
- Project detection & smart open: auto-detects Rust / Node / Python / Java / C# / Go / Unity / C++ / PHP / Ruby / Dart / Flutter / Kotlin / Swift / Android projects (cards show the matched feature file), finds IDEs and common tools automatically, opens / reveals / opens-in-IDE from file rows, and desktop shortcuts can wake RootUp into the project
- Onboarding & help center: first-run welcome dialog, global sidebar help (getting started / search & advanced usage), IDE selection guidance, and on-demand IDE setup hints
- First public release: NSIS installer (per-user, no admin, Chinese/English language choice), full brand icon set, installer verification
- Controlled archive & undo: single / batch / filtered-file archiving, whole-folder project archiving with shortcut updates, and an optional auto-archive toggle (clear categories only); everything is undoable
- Study page (v0.8.0): timeline weekly schedule (dates, today marker, current-time line, odd/even/custom weeks, Monday/Sunday start, stacked cards with spread-out viewing) plus homework tracking (deadline sorting, status/course filters, short notes + expandable details, overdue/days-left labels, mark-done confirmation, active-only default); semesters act as schedules with create/edit/copy/delete and backend `study.json` persistence; course names feed file labels automatically; buttons follow the Windows yes-left/no-right convention
- Reminders & settings (v0.8.1): homework deadline reminders (off by default, configurable lead days; study-page banner + list grouping + tray count/direct open); persistent close behavior (ask / background / quit); language dropdown with a language registry; settings grouped into General / Monitoring & classification / Archive / Study reminders / Advanced; tray left-click open, dynamic menu (due-homework shortcuts, auto-archive and theme toggles); desktop “Open homework” shortcut
- Monitoring UX & visuals (v0.8.2): removing a watched folder also cleans its index (restorable by rescanning); native “Browse…” folder picker, folder drag & drop, one-click common folders; motion tokens with global reduced-motion support, button micro-interactions, a unified tooltip system, and a settings guide (row click = explain, edit button = edit) with a new “Settings guide” help section
- Experience catch-up (v0.8.3): custom dropdowns with type-to-filter replace all native selects; project page gains browse / drag & drop / common folders / paste cleaning with manual-vs-auto source and detection-basis badges; recognition matrix expanded and noise folders skipped; tray uses multi-size icons with a due-homework red-dot badge; settings & help center visuals unified

### Search Syntax

- `type:pdf` — filter by extension
- `label:document` — filter by category label
- `state:pending` — filter by state
- `size:>10MB` — filter by size
- `before:2026-08-01` — filter by modified date
- Combine conditions, e.g. `type:pdf notes`

### Planned Features

Fixed version roadmap: v0.8.3 experience catch-up patch (custom dropdowns, project page & recognition fixes, tray icons), v0.8.4 storage & scan foundation, v0.8.5 fast scan & query, v0.8.6 size & performance, v0.8.7 unit unification, then the platform line up to v2.0. See [docs/ROADMAP.md](docs/ROADMAP.md), [docs/VISION.md](docs/VISION.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Tech Stack

- Desktop shell: Tauri v2 (Rust)
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Icons: lucide-react
- i18n: i18next

### Quality Checks

- Frontend tests: `npm test` (394 cases)
- Rust tests: `cargo test` (271 cases)
- Architecture check: `npm run check:arch` (one-way dependencies)
- Release gate: `scripts/pre-release-check.ps1` (unit tests, build, smoke, AI deep-link acceptance; requires a desktop session)
- Performance baseline (custom harness, local-only): `scripts/bench-all.ps1` with deterministic corpus self-check and extended host fingerprint; only same-machine versions are compared, see [benchmarks/README.md](benchmarks/README.md)

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
