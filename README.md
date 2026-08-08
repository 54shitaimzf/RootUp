<p align="center">
  <img src="resources/icons/rootup-sprout.png" width="96" alt="RootUp" />
</p>

<h1 align="center">RootUp</h1>

<p align="center"><strong>把散落的文件，变成随找随到的秩序。</strong></p>

<p align="center">
  <a href="https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml">
    <img src="https://github.com/54shitaimzf/RootUp/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
</p>

RootUp 是一款面向学生和日常桌面整理的 Windows 工具。下载、桌面、课程资料、作业文件散落各处时，它会自动完成分类与索引，让你随时搜索、一键归档，并且任何归档都能反悔。

## 核心功能

### 文件整理与搜索

- **自动分类**：新文件进入监控目录后自动按类型归类——文档、图片、视频、音频、压缩包、代码、安装包、数据；也支持自定义标签（显示名、图标、颜色）。
- **实时索引**：监控目录全量扫描 + 实时更新，文件一出现就能搜到；课程名称会自动成为标签，学业资料随课程归位。
- **强搜索**：支持文件名/路径搜索和条件语法（见下文），输入时自动补全，常用筛选条件以 chips 一键点选。
- **快速查询**：0.8.5 起查询提速 70%+，翻页改用稳定的游标分页；支持显式 AND 标签语法（`+label:` 或 `label:a AND label:b`）。
- **规则与方案**：忽略规则和分类映射可自由编辑，内置默认/编程开发/素材创作三套模板，也可以保存为自己的方案随时套用。

### 安全归档，随时反悔

- 单文件、批量、筛选结果、整个项目都可以归档；项目归档时桌面快捷方式自动联动。
- 可选“自动归档”：只归档分类明确的新文件，默认关闭。
- 所有归档都记录在案，一键撤销。

### 学业管理

- **课程表**：周视图时间轴，支持单双周/指定周次、堆叠与铺开查看；学期即课表，可新建、编辑、复制、删除。
- **作业管理**：按截止时间排序，支持状态/课程筛选、短备注与详情、逾期/剩余天数提示、标记完成。
- **截止提醒**：可选提前 N 天提醒（默认关闭），学业页提示条、列表分组、托盘计数直达；还有“打开未完成作业”桌面快捷方式。

### 项目识别与智能打开

- 自动识别 15 种常见项目类型（Rust、Node、Python、Java、C#、Go、Unity、C++、PHP、Ruby、Dart、Flutter、Kotlin、Swift、Android 等）。
- 自动发现 VS Code、Cursor、JetBrains、MATLAB、Typora、Obsidian 等工具，文件行一键打开 / 定位 / 用 IDE 打开。
- 桌面快捷方式双击即可唤起 RootUp 直达项目。

### 桌面体验

- 系统托盘驻留：左键打开，动态菜单直达临期作业、快速切换主题与自动归档；临期/逾期作业有红点角标。
- 关闭即后台：后台运行不占浏览器内存，随时可从托盘唤回；也可选择直接退出，行为可记忆。
- 浅色 / 深色 / 跟随系统主题，中文 / English 界面随时切换。
- 首次启动欢迎引导与内置帮助中心；常用目录一键添加，支持文件夹拖拽。
- 文件列表可按名称 / 类型 / 大小 / 修改时间 / 标签排序，加载更多时保持滚动位置。

## 搜索语法

搜索框是文件页的核心入口：输入文字按文件名/路径查找，输入语法按条件筛选；自动补全与常用 chips 让大部分筛选不用手打。

| 语法 | 含义 | 示例 |
| --- | --- | --- |
| `type:` | 按扩展名 | `type:pdf` |
| `label:` | 按标签 | `label:document` |
| `state:` | 按状态 | `state:pending` |
| `size:` | 按大小 | `size:>10MB` |
| `before:` / `after:` | 按修改时间 | `before:2026-08-01` |
| `+label:` / `AND` | 按标签且需同时满足 | `label:高数 +label:物理` |

- 多个条件可组合，如 `type:pdf 高数`（同时满足）。
- 同一维度多个标签默认为“任一命中”，如 `label:math label:english`（满足其一即可）；需要同时命中时用 `+label:` 或 `AND`。
- 完整语法说明见搜索框右侧的“?”按钮。

## 快速上手

1. 安装 RootUp（见下文），启动后按引导添加要整理的文件夹（下载、桌面、文档等）。
2. 首次扫描完成后，文件页即可搜索与筛选。
3. 可选：开启自动归档、编辑分类规则，或在学业页建立课程表。
4. 一切归档均可撤销，放心整理。

## 性能

RootUp 使用本地索引，扫描、搜索与归档都很快。以下为 0.8.5 官方基线（开发机本地基准，p50，对比 0.8.4）：

| 指标 | 0.8.5 | 对比 0.8.4 |
| --- | --- | --- |
| 冷启动 | 509.8 ms | -1.9% |
| 可交互耗时（冷） | 1808.9 ms | 持平 |
| 引擎扫描 10k（mixed） | 302.4 ms | 持平 |
| 引擎扫描 100k（mixed） | 4281.4 ms | +41.5%（索引维护代价，待安静环境复核） |
| 文本查询（100k 库） | 10.2 ms | -78.7% |
| 标签查询（100k 库） | 10.9 ms | -74.3% |
| 翻页单页（OFFSET / keyset） | 10.5 / 0.1 ms | 游标分页生效 |
| 空闲内存占用 | 36.3 MB | +3.2% |
| 索引库体积（10k 文件） | 9.5 MB | +24.4%（新增索引） |
| 前端包体积（JS gzip） | 151.8 KB | +5.4% |

完整的 50 项指标、逐版本对比与趋势图见 [benchmarks/README.md](benchmarks/README.md)。

## 安装

- 从 [GitHub Releases](https://github.com/54shitaimzf/RootUp/releases) 下载 `RootUp_0.8.5_x64-setup.exe`。
- per-user 安装，无需管理员权限，安装时可选中文或 English。
- 安装包未做数字签名，Windows SmartScreen 首次运行会提示“未知发布者”，选择“仍要运行”即可，功能不受影响。
- 需要 WebView2 运行时（Windows 10/11 一般已内置，缺失时安装器会引导下载）。

## 路线图

- **v0.8.5（已发布）**：快速扫描与查询——查询提速 70%+、游标分页、显式 AND 语法、NTFS 快速扫描能力。
- **v0.8.6（下一步）**：更大文件量的流畅体验（虚拟滚动）、更小的安装包、MFT 快速基线。
- **v0.8.7 及以后**：文件/项目/软件统一管理。

完整路线与设计文档见 [docs/ROADMAP.md](docs/ROADMAP.md)、[docs/VISION.md](docs/VISION.md)。

## 从源码构建

前置：Rust（stable）与 Node.js（20+）。

```bash
npm install
npm run tauri dev      # 开发运行
npm run tauri build    # 发布构建
```

> 注意：发布构建必须使用 `npm run tauri build`；直接运行 `cargo build --release` 不会嵌入前端资源。

### 质量与测试

- 前端测试 444 项、Rust 测试 314 项
- `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`
- 架构单向依赖校验：`npm run check:arch` / `npm run check:arch:rust`
- 发布门禁 `scripts/pre-release-check.ps1`：全部测试、构建、日志冒烟与真实链路验收

### 项目结构

- `src/`：React 前端（页面、组件、主题、国际化）
- `src-tauri/`：Rust 后端与桌面壳（commands / core / infra 分层）
- `docs/`：愿景、路线图、架构与版本报告
- `scripts/`：构建、测试、基准与发布脚本
- `resources/`：图标等资源

## 文档

[路线图](docs/ROADMAP.md) · [架构](docs/ARCHITECTURE.md) · [版本报告](docs/reports/) · [变更日志](CHANGELOG.md)

## 许可证

本项目使用 **GNU GPLv3**，详见 [LICENSE](LICENSE)。

---

## English

RootUp is a Windows desktop app that keeps your files organized without the effort: automatic classification, one-click archive with undo, project-aware quick open, and study tools for course schedules and homework.

### Features

- **File organization & search** — watch folders, auto-classify into Documents / Images / Videos / Audio / Archives / Code / Installers / Data, custom labels, full-text search with syntax (`type:` / `label:` / `state:` / `size:` / `before:` / `after:`), editable ignore rules and classification presets. Since 0.8.5, queries are 70%+ faster with stable cursor pagination, and explicit AND syntax (`+label:` or `label:a AND label:b`) is supported.
- **Safe archiving** — archive files, filtered results or whole projects (desktop shortcuts update automatically); optional auto-archive for clearly classified files; everything can be undone.
- **Study tools** — weekly course schedule (odd/even/custom weeks), homework tracking with deadlines and reminders, tray badge and one-click jump to unfinished homework.
- **Projects & IDEs** — auto-detects 15 common project types and tools like VS Code, Cursor, JetBrains, MATLAB, Typora and Obsidian; open / reveal / open in IDE from any file row.
- **Desktop experience** — tray residency with zero background browser memory, light/dark/system theme, 中文/English UI, first-run onboarding and built-in help center.

### Search syntax

| Syntax | Meaning | Example |
| --- | --- | --- |
| `type:` | Filter by extension | `type:pdf` |
| `label:` | Filter by label | `label:document` |
| `state:` | Filter by state | `state:pending` |
| `size:` | Filter by size | `size:>10MB` |
| `before:` / `after:` | Filter by modified date | `before:2026-08-01` |
| `+label:` / `AND` | Filter by labels that must all match | `label:math +label:physics` |

Conditions can be combined, e.g. `type:pdf notes`. Multiple labels of the same dimension match with OR semantics by default; use `+label:` or `AND` to require all of them.

### Performance (v0.8.5 baseline, p50, vs 0.8.4)

| Metric | 0.8.5 | vs 0.8.4 |
| --- | --- | --- |
| Cold startup | 509.8 ms | -1.9% |
| Time to interactive (cold) | 1808.9 ms | flat |
| Engine scan 10k (mixed) | 302.4 ms | flat |
| Engine scan 100k (mixed) | 4281.4 ms | +41.5% (index maintenance; to re-verify) |
| Text query (100k index) | 10.2 ms | -78.7% |
| Label query (100k index) | 10.9 ms | -74.3% |
| Paged query (OFFSET / keyset) | 10.5 / 0.1 ms | cursor pagination |
| Idle memory | 36.3 MB | +3.2% |
| Index DB size (10k files) | 9.5 MB | +24.4% (new indexes) |
| JS bundle gzip | 151.8 KB | +5.4% |

All 50 metrics, per-version comparisons and trend charts: [benchmarks/README.md](benchmarks/README.md).

### Install

Download `RootUp_0.8.5_x64-setup.exe` from [GitHub Releases](https://github.com/54shitaimzf/RootUp/releases). Per-user NSIS installer, no admin required, Chinese/English installer languages. WebView2 runtime is required (usually preinstalled on Windows 10/11). The installer is unsigned — SmartScreen may show "Unknown publisher"; choose "Run anyway".

### Roadmap

v0.8.5 released (fast scanning & query: 70%+ faster queries, cursor pagination, explicit AND syntax, NTFS/USN fast-scan capability). Next: v0.8.6 (virtual scrolling, smaller bundles, MFT fast baseline). See [docs/ROADMAP.md](docs/ROADMAP.md).

### Build from source

Prerequisites: Rust (stable) and Node.js (20+).

```bash
npm install
npm run tauri dev
npm run tauri build
```

### License

GNU GPLv3. See [LICENSE](LICENSE).
