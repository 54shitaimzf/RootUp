# 架构说明（ARCHITECTURE）

## 技术栈

- 桌面壳：Tauri v2（Rust），负责托盘、窗口生命周期、单实例与设置存储
- 前端：React + TypeScript + Vite + Tailwind CSS v4 + i18next + lucide-react
- 许可证：GPL-3.0-or-later

## 目录结构与依赖规则

```
RootUp/
├── src/                          # React 前端
│   ├── main.tsx                  # 入口（仅挂载 App）
│   ├── App.tsx                   # 布局组装：Sidebar + 页面切换 + 主题/i18n
│   ├── pages/                    # 页面层入口：Files / Homework / Courses / Tools / Settings
│   ├── features/                 # 功能域私有组件：settings/（四个规则弹窗），随功能生长
│   ├── components/               # 通用 UI 层：Modal、Button、Banner、Sidebar 等跨功能复用组件
│   ├── hooks/                    # 通用逻辑层：useSettings / useFiles / useScan
│   ├── lib/                      # 基础设施层：类型化 invoke 封装（Tauri API 边界）
│   ├── theme/                    # 横切：tokens.css（设计令牌）+ ThemeProvider
│   ├── i18n/                     # 横切：i18next 配置与 zh-CN / en 字典
│   └── styles/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # 入口（仅调用 run()）
│   │   ├── lib.rs                # run()：模块组装入口
│   │   ├── app.rs                # Builder：插件、托盘、窗口事件、命令注册
│   │   ├── commands/             # API 边界层：参数校验 → 调 core / infra
│   │   ├── core/                 # 业务逻辑层：纯 Rust，不依赖 Tauri
│   │   └── infra/                # 平台适配层：storage、tray、window
│   ├── tauri.conf.json
│   └── capabilities/
├── docs/                         # VISION / ROADMAP / ARCHITECTURE
└── resources/                    # 图标等非代码资源
```

**依赖方向**（上层可依赖下层，禁止反向依赖；同层模块通过上层协调，不互相直连）：

```
pages → components → hooks → lib(API) → Tauri commands → core 业务逻辑
                                        ↑                        ↑
                       theme / i18n（横切，任意层可读）    infra（持久化/托盘/窗口）
```

## 后台生命周期（关闭即销毁）

1. 用户点击窗口关闭 → Rust 拦截 `CloseRequested` 并 `prevent_close`，向前端广播 `close-requested`。
2. 前端弹出确认框，三个选择：
   - **取消**：仅关闭弹窗，窗口保持。
   - **后台运行**：调用 `hide_to_tray` 命令，Rust 销毁窗口——WebView 进程退出，后台只保留轻量托盘进程（零浏览器内存）。
   - **退出程序**：调用 `quit_app` 命令，完全退出应用。
3. 托盘菜单"打开"：窗口不存在则按统一配置重建，存在则显示并聚焦。
4. 单实例插件保证二次启动时唤起已有窗口，不重复开窗。
5. `RunEvent::ExitRequested` 默认被 `prevent_exit()` 拦截——这是"关闭即销毁"能成立的护栏：
   最后一个窗口销毁会让框架触发退出请求，不拦截则整个进程（含托盘）随之退出。
6. 主动退出必须先行置位 `QuitFlag`（托盘菜单"退出"、确认弹窗"退出程序"），
   事件循环据此放行；其余任何 `ExitRequested` 一律阻止。

## 工程约定（防止同类问题复发）

- **共享状态单一数据源**：跨组件共享的设置等状态必须通过 Provider（如
  `SettingsProvider`）提供，消费方统一用对应 hook 读取；禁止在多个组件中
  各自实例化状态并假设它们互通。
- **组件样式自包含**：组件不得依赖外部容器的文字颜色等样式继承，关键文本
  必须显式声明浅色/深色两类颜色；弹窗等浮层即使渲染在布局容器之外也要完整可读。
- **生命周期契约必做项**：桌面壳改动必须对照"后台生命周期"一节核对
  `CloseRequested`、`ExitRequested`、单实例三件事，避免破坏后台常驻行为。

## 验收冒烟清单

每次改动涉及上述模块后，至少手动验证：

- 语言切换即时生效，且高亮跟随当前语言（重启后保持）
- 主题三态切换即时生效，深色模式下所有弹窗文字可读
- 点击"后台运行"后：窗口销毁、进程仍在、托盘图标仍在且菜单可打开窗口
- 托盘/弹窗"退出"能真正结束进程
- 二次启动不重复开窗，且能唤起已销毁的窗口
- 设置修改后重启应用仍然保留

## 设置数据流与配置模型

`Settings { version, theme, language, watched_dirs, ignore_rules{extensions,prefixes,exact_names}, classify_overrides[] }`

```
前端 lib/tauri.ts → invoke → commands/settings.rs（校验）
                    → infra/storage.rs（tauri-plugin-store，settings.json）
                    → core/settings.rs（模型与默认值）
```

**版本化与向前兼容**：`CURRENT_VERSION` 为配置版本（当前 1）；新增字段必须带 `#[serde(default)]`，结构体不启用 `deny_unknown_fields`；结构性升级在 `Settings::migrate()` 中按版本号逐级迁移。旧版本配置文件永远可被新版本读取（未知字段容忍 + 缺省字段取默认）。

**损坏容错**：`infra/storage.rs` 的 `backup_corrupt_settings` 在加载前校验 JSON，损坏文件改名为 `settings.corrupt-<时间戳>.bak` 并回退默认。

**规则装配**：`app.rs` 启动时由 `Settings` 构建 `IgnoreMatcher::from_rules(...)` 与 `ExtensionClassifier::with_overrides(...)`，监听与扫描共用；规则变更保存后重启生效（不做热更新）。

**模板与自定义方案**：三套内置模板（默认/编程开发/素材创作）为前端常量（`src/lib/presets.ts`）；自定义方案是「忽略规则 + 分类覆盖」的命名快照，经 `core/schemes.rs` 校验、`infra/scheme_store.rs` 原子写入独立文件 `schemes.json`（损坏备份 `schemes.corrupt-<时间戳>.bak`，重置设置不删除方案），命令层 `commands/schemes.rs` 提供 `list/save/rename/delete`。「应用方案」在前端读取方案内容后走现有 `set_settings`，后端不拆分写路径。

**设置页交互**：设置页以索引行承载低频高级配置——规则方案（套用/保存）、忽略规则、分类映射各占一行，编辑分别进入独立弹窗；分类映射弹窗只展示「内置 + 覆盖」合并后的生效视图（`src/lib/effectiveMap.ts` 纯函数负责合并与单扩展名拆分/合并规则），点击任意扩展名可立即改类别或恢复默认，弹窗草稿与方案快照互不混用。

**配置蓝图（迭代 B）**：归档目标结构、扫描选项（递归/隐藏文件/最大大小）、AI 分类开关、皮肤等字段待功能落地时按版本化约定新增，不提前预留空字段。

`core` 层为纯 Rust 数据结构，不依赖 Tauri 类型，便于后续扩展字段与单元测试。

## 索引、扫描与分类模块（迭代 A.5）

**新增模块与职责**：
- `core/path.rs`：`normalize_path`（统一 `/` 分隔符、去尾斜杠）与 `is_subpath`（组件级包含判定，Windows 小写比较）；所有入库、差集、前缀匹配、目录去重统一走它。
- `core/classify.rs`：`Category` 枚举、`Classifier` trait、`ClassifierChain`（顺序执行 + 跨分类器去重 + 每步 debug 日志）、`ExtensionClassifier`（扩展名→大类映射）；labels 逗号分隔小写 key，字符集 `[a-z0-9-]`，写入前校验。
- `core/query.rs`：`parse_query` 解析 `type:` / `label:`（别名 `tag:`）/ `state:`（别名 `status:`）/ `size:>/<N~M`（B/KB/MB/GB）/ `before:` / `after:`（毫秒时间戳或 `YYYY-MM-DD` 本地时区）；非法值与未知前缀回落为普通文本；同维度 OR、跨维度 AND。
- `core/scan.rs`：`ScanEvent` / `ScanSummary` / `ScanParams` / `ScanEventSink` / `diff_missing` / `record_from_scan` 纯逻辑。
- `core/watched.rs`：`check_add`（相等/被覆盖/将覆盖三态）与 `dedupe_watched`（启动自愈）纯函数。
- `infra/scanner.rs`：`ScanService` 串行队列后台扫描（walkdir 不跟随符号链接）、批量事务、进度节流、取消、快照差集、删除风暴保护、可用性检查、候选二次确认。

**依赖注入约定**：`ScanService::new(store, classifier, matcher, params, sink)` 全注入；Tauri 侧仅提供 `TauriScanSink`（emit 前端事件）与分类链组装，业务层零 Tauri 依赖；AI/课程分类 = 新增 `Classifier` 追加进链。

**事件协议**：`scan-progress`（`ScanEvent::Progress`）与 `scan-finished`（Finished/Failed/Cancelled），payload 为 `ScanEvent`（`type` 判别字段）。

**类别单一来源**：`list_categories` 返回静态类别（筛选 Chips 与图标映射），`list_labels` 返回库内动态标签（标签多选），前端不硬编码类别列表。

**错误消息规范**：`模块: 消息` 前缀（如 `scan: 目录不可访问 ...`），命令层透传，测试断言前缀；本轮不引入 thiserror。

**文件安全基线**：扫描只读 metadata；「删除」仅为索引状态标记；快照差集 + 风暴保护 + 可用性检查 + 候选复核构成误判防护；物理归档（迭代 B）须启用事务性移动 + 撤销 + 目标存在性检查。

**后续候选**：排序（`sort_by/sort_dir`）、统计概览（`get_stats`）、`scan_meta` 表、`resources/icons/filetypes/` SVG 源、游标分页、`RwLock` 读写分离、rayon 并行、thiserror、E2E 框架。

## 文件页搜索与筛选

- **搜索为核心**：`components/SearchAutocomplete.tsx` 为搜索框 + 自动补全（combobox），候选来自 `list_categories` / `list_labels` / 固定状态集（状态仅存在于搜索语法与补全，不在界面筛选行），经 `lib/autocomplete.ts` 纯函数匹配与插入（维度前缀补全、子串匹配、替换/追加）。
- **筛选 chips 频率排序**：`FilterBar` 为分类 / 标签两行横向滚动列表（状态筛选不在界面，`state:` 保留给搜索语法），进入页面时按习惯快照排序一次、会话内稳定（已选置前仅体现在高亮与自动滚入视野，不实时重排）；习惯数据由 `hooks/useFilterHabits.ts` 读写（存储见下条）。
- **习惯数据管理**：筛选/补全使用习惯存应用数据目录 `habits.json`（Rust 侧 `core/habits.rs` 校验 + `infra/habit_store.rs` 原子写入与损坏备份 + `commands/habits.rs` 读写），与 settings 完全分离；前端 `useFilterHabits` 800ms 防抖合并写盘，启动时一次性迁移旧 localStorage 数据（成功即删除旧键）；恢复默认设置不清空习惯。日志行：`habits: 保存/迁移/损坏回退`。自动补全关键词（`type:` 等）固定顺序，不参与习惯统计；筛选行点击与补全添加标签共用同一习惯键。
- **查询去重**：搜索文本与 chips/自动补全统一汇入 `buildQuery`，按原文 Set 去重后再发送后端。
- **日志约定**：`filter: 切换 kind=... key=... active=...`、`autocomplete: 插入 kind=... key=... token=...`、`filter: 习惯数据损坏已回退`，供冒烟与排查。
- **转义候选**：Windows 文件名不允许冒号，真实文件名不会与 `type:`/`label:` 等语法 token 冲突；未来如需搜索含冒号字符串，在 `parse_query` 增加 `\` 转义（如 `\label:高数` 视为纯文本），本次不实现。
- **弹层样式约定**：锚定/悬浮层（搜索帮助、自动补全下拉、分类映射编辑浮层等）与居中 Modal（设置弹窗、确认弹窗、关闭确认弹窗）统一使用 `floating-panel`——无硬边框，细 ring + `--shadow-float` 双层投影 + 背景模糊 + 半透明底，深浅主题由 `.dark .floating-panel` 适配；`--shadow-float` 为普通 CSS 变量，皮肤可运行时覆盖。锚定/悬浮层追加 `pop-in` 淡入上移动画（约 120ms），居中 Modal 保留遮罩与标题/底部分隔线以维持长内容可读性。新增弹层一律复用该约定，禁止手写边框/投影变体。
- **文本层级与弹窗高度约定**：文本三级语义为 `--text-strong`（页面/弹窗标题）、`--text-secondary`（区块标题，配 `SectionLabel`）、`--text-muted`（说明/计数），工具类 `.text-strong / .text-secondary / .text-muted` 为唯一样式来源，皮肤可运行时覆盖。`Modal` 支持可选 `contentHeight`（内容区 `flex-none` + 固定高度 + 内部滚动）；仅内容可能随交互变化高度或必然超屏的弹窗启用（当前仅分类映射传 `h-[65vh]`），其余弹窗保持自适应，禁止为小弹窗固定高度。
- **测试策略与设施**：纯逻辑（lib/、core/、infra/）用 vitest / cargo test 覆盖；组件与 hooks 用 `@testing-library/react` + jsdom 覆盖交互边界（键盘协议、弹窗开关、分页合并、事件状态机），mock 约定为 `vi.mock("../lib/tauri")` 与 `vi.mock("@tauri-apps/api/event")`，测试设施全部位于 devDependencies，不进入生产产物。新增组件测试照此扩展，禁止跳过关键交互边界。
- **日志与校验约定**：前端行为日志统一 `ui: ` 前缀（如 `ui: 刷新`、`ui: 加载更多 offset=N`、`ui: 清空搜索`、`ui: 取消扫描`），后端子系统沿用各自前缀；`settings: 加载` 由 `get_settings` 输出，冒烟脚本据此断言。`scripts/check-arch.ps1` 校验 `pages → features → components/hooks → lib` 单向依赖（同层仅允许 features/components/hooks/lib 互引），以 `npm run check:arch` 运行并在 CI 强制。
- **AddDirOutcome 契约**：`add_watched_dir` 返回 `{ message, dir }`，其中 `dir` 为规范化后的路径；前端必须用返回值同步列表，不得回显用户输入原文（避免大小写/斜杠不一致）。
- **项目识别与智能打开**：`core/project.rs` 提供 `ProjectKind`/`ProjectInfo`/`ProjectDetector` trait（AI 后续 = 新实现插入）、`FeatureDetector` 特征表（Unity→Rust→Go→Java→C#→Node→Python）、`find_project_root`（文件向上找项目根，最多 5 层）与 `discover_projects`（watched 子目录 + 手动目录，跳过噪音目录）。`core/tools.rs` 是“打开意图”单一来源：项目类型 → IDE 候选、扩展名 → 工具候选（md/ipynb/matlab/origin/mathematica/multisim/proteus/cad/solidworks/ps/ai/tex），Office/PDF 与未映射类型走系统默认。`infra/app_finder.rs` 应用查找顺序：自定义命令（`tool` 匹配优先，空 = 通用兜底）→ PATH 命令名（含 `.exe`）→ Windows App Paths 注册表（winreg）→ 内置常见路径（支持单段 `*` glob）→ 系统默认打开；`CommandRunner` trait 隔离进程启动。`infra/shortcut.rs` 生成 `rootup.exe --open-project <path>` 的 `.lnk`（重名递增、内嵌图标缓存）。启动参数 `--open-project` 在首次启动（setup）与单实例回调中解析并 emit `project-open`。
- **日志前缀**：`project: 添加/移除/发现/启动参数打开`、`ide: 打开/回退`、`open: 文件/定位/默认`、`shortcut: 创建`、`tools: 意图`（预留）；前端行为统一 `ui: `（打开项目/文件/定位/创建快捷方式/添加移除项目）。

## 扩展点

- **多语言**：在 `src/i18n/locales/` 新增语言文件，并在 `core/settings.rs` 的校验常量中登记语言代码。
- **主题**：三态（跟随系统/浅/深）由 `theme/ThemeProvider.tsx` 管理，`matchMedia` 监听系统变化。
- **皮肤**：皮肤 = 一套令牌 + 全局变量 + 组件变体的整套覆盖。默认皮肤由三部分组成：`theme/tokens.css` 的 `@theme` 品牌令牌（颜色/圆角/阴影）、`styles/global.css` 的全局 CSS 变量（滚动条色、`--shadow-float`、文本三级变量）、共享组件变体（`Button` 的 variant / `Banner` 的 variant / `Chip` 的 variant / `IconButton` 的 tone）。新增皮肤时整体替换/叠加即可，组件逻辑零改动；v1 仅提供 default。
- **共享交互组件**：`components/Button.tsx`（primary/secondary/danger/amber/ghost × xs/sm/md，样式等价映射见组件内注释与 README）、`components/Banner.tsx`（brand/warn/error，可选关闭）、`components/IconButton.tsx`（xs/sm/md × neutral/danger/brand/inherit，统一图标按钮与 × 悬停反馈）、`components/Chip.tsx`（sm=h-6 / md=h-7 × neutral/active/brand/selectable，支持 icon/badge/onRemove/onClick，文件页与设置弹窗共用）、`components/SectionLabel.tsx`（sm/xs 两级区块标题）、`components/ConfirmDialog.tsx`（基于 Modal 的确认弹窗）、`components/ConfirmButton.tsx`（两步确认状态封装）。所有新页面优先复用，禁止复制手写变体。
- **基础表单与状态组件**：`Input`（sm/md，统一边框/聚焦/深浅色）、`Select`、`InlineNotice`（success/error/info）、`EmptyState`、`PageHeader`、`SyntaxTable`（语法行单一来源）均为共享组件；新增输入/提示/空态/页头一律复用，禁止手写等价样式。
- **帮助中心与新手引导**：`HelpCenterProvider` 全局装配（侧栏入口 + 首次欢迎 + 分组帮助弹窗）；首次欢迎用 localStorage `rootup.onboarding.v1` 一次性标记，帮助中心可重看；IDE 指导数据在 `lib/ideGuide.ts`（仅官方链接）；后端 `list_detected_tools` 返回已检测工具 key，`open_url` 仅允许 https 且命中 `core/tools.rs` 白名单域名（`ALLOWED_DOWNLOAD_DOMAINS`），非法 URL 拒绝并记日志。
- **新页面**：在 `pages/` 新增页面，注册到 `Sidebar` 的导航项与 i18n 文案；当页面长出多个私有组件时，提级为 `features/<name>/`（自包含组件 + hooks + API），`pages/` 只保留入口。
- **托盘菜单**：在 `infra/tray.rs` 中扩展菜单项与事件处理。
- **后端命令**：在 `commands/` 新增模块，并在 `app.rs` 的 `invoke_handler` 中注册。

## 演进规则

- `components/` 只放跨功能可复用的组件；页面私有组件随功能生长到 `features/`。
- 新增依赖前先评估必要性（轻量原则）；当前不引入路由、状态管理等非必要库。
- 保持单向依赖，代码审查时以本文件依赖图为基准。
