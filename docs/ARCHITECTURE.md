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
│   ├── pages/                    # 页面层入口：文件 / 项目 / 学业 / 小工具 / 设置
│   ├── features/                 # 功能域私有 UI：features/<domain>/components/（页面级组件与测试）
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

**目录约定**：

- `pages/` 只保留页面壳（状态装配与布局，不承载大段 UI 实现）。
- `features/<domain>/components/` 放页面级 UI 组件与对应测试（如 `features/study/components/`、`features/settings/components/`）；页面壳通过该路径引用，`features/<domain>/` 根目录不散放 UI 文件。
- `components/` 只放跨域通用组件（Modal、Button、Input、Field、FormSection 等）。
- `lib/` 只放纯逻辑与后端契约（类型化 invoke 封装、纯函数、数据模型）。
- `check-arch` 的「pages → features → components/hooks → lib」单向依赖规则不变，新增文件必须遵守。

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

## 版本号规则与发布纪律

采用语义化版本（SemVer），1.0 前与 1.0 后两套规则：

| 阶段 | 格式 | 规则 |
|---|---|---|
| 1.0 前 | `0.Y.Z` | Y = 功能迭代或破坏性变更；Z = bug 修复/内部改动；MAJOR 恒为 0 |
| 1.0 后 | `X.Y.Z` | X = 破坏性变更；Y = 向后兼容新功能；Z = bug 修复 |
| 预发布 | `0.Y.Z-rc.N` 等 | 正式发布前验证用；tag 需带 prerelease，release 流水线按 prerelease 处理 |

发布纪律：

- **五处同步**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、
  `src-tauri/tauri.conf.json`、`src/lib/constants.ts` 版本必须完全一致；
  `npm run check:version` 强制校验，CI 与 release 流水线均执行。
- **CHANGELOG**：每个发布版本一个 `## [X.Y.Z] - 日期` 段落（Keep a Changelog
  风格）；开发期在 `## [Unreleased]` 累积变更，发布时转正。
- **tag 与发布**：正式发布打 `vX.Y.Z` tag；release 流水线校验 tag 版本与五处
  一致，自动构建 NSIS 安装包并运行 `verify-installer.ps1`（安装→冒烟→卸载）。
- **开发版**：发布后立即推进为下一个目标版本的 `-dev` 形式——下个迭代为功能
  版本则 `0.(Y+1).0-dev`，仅为修复则 `0.Y.(Z+1)-dev`；release 时去掉 `-dev`。
- **0.x 允许破坏性变更**：升 Y 并在 CHANGELOG 标注 `**Breaking**`；仅修复 bug
  升 Z，不额外升号。
- **数据版本与应用版本解耦**：`Settings.version`（配置 schema）与未来的数据库
  schema 版本独立演进，经 `Settings::migrate()` / 数据库迁移逐级升级；应用版本
  升级不代表数据格式必然变化。
- **1.0 门槛**：核心闭环稳定（安装→监听→搜索→打开→归档）、存储 schema 有迁移
  且无已知数据丢失 bug、真实用户试用无重大回归、命令与配置接口语义稳定；达到后
  再升 1.0，并承担向后兼容承诺。

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

**版本化与向前兼容**：`CURRENT_VERSION` 为配置版本（当前 3，v2 起含 archive_root/auto_archive，v3 起含 close_action/reminder_enabled/reminder_lead_days）；新增字段必须带 `#[serde(default)]`，结构体不启用 `deny_unknown_fields`；结构性升级在 `Settings::migrate()` 中按版本号逐级迁移。旧版本配置文件永远可被新版本读取（未知字段容忍 + 缺省字段取默认）。

**语言三处约定**：新增语言必须同步三处——前端字典（`src/i18n/locales/`）、前端语言注册表（`src/lib/languages.ts`，下拉与后续语言相关 UI 的单一来源）、后端 `Language` 白名单（`core/settings.rs` 校验）；任何一处缺失即视为未完成，i18n 一致性测试覆盖字典成对。

**损坏容错**：`infra/storage.rs` 的 `backup_corrupt_settings` 在加载前校验 JSON，损坏文件改名为 `settings.corrupt-<时间戳>.bak` 并回退默认。

**应用自有领域 JSON 的统一本地文件层**：labels/schemes/habits/study 四个领域文件统一走 `infra/local_file.rs` 的 `read_json<T>`（缺失返回 None；损坏备份 `*.corrupt-<时间戳>.bak` 后回退）与 `write_json_atomic<T>`（建目录 → 临时文件 → rename，失败清理），各领域 store 不再各自实现读写与损坏备份。settings 仍由 tauri-plugin-store 管理（配置边界），不并入该层。

**规则装配**：`app.rs` 启动时由 `Settings` 构建 `IgnoreMatcher::from_rules(...)` 与 `ExtensionClassifier::with_overrides(...)`，监听与扫描共用；规则变更保存后重启生效（不做热更新）。

**模板与自定义方案**：三套内置模板（默认/编程开发/素材创作）为前端常量（`src/lib/presets.ts`）；自定义方案是「忽略规则 + 分类覆盖」的命名快照，经 `core/schemes.rs` 校验、`infra/scheme_store.rs` 原子写入独立文件 `schemes.json`（损坏备份 `schemes.corrupt-<时间戳>.bak`，重置设置不删除方案），命令层 `commands/schemes.rs` 提供 `list/save/rename/delete`。「应用方案」在前端读取方案内容后走现有 `set_settings`，后端不拆分写路径。

**设置页交互**：设置页以索引行承载低频高级配置——规则方案（套用/保存）、忽略规则、分类映射各占一行，编辑分别进入独立弹窗；分类映射弹窗只展示「内置 + 覆盖」合并后的生效视图（`src/lib/effectiveMap.ts` 纯函数负责合并与单扩展名拆分/合并规则），点击任意扩展名可立即改类别或恢复默认，弹窗草稿与方案快照互不混用。

**配置蓝图（迭代 B）**：归档目标结构、扫描选项（递归/隐藏文件/最大大小）、AI 分类开关、皮肤等字段待功能落地时按版本化约定新增，不提前预留空字段。学业数据（课程表 / 作业）计划以独立数据模块承载（`core/study.rs` + 索引库新表或独立数据文件），不写入 settings.json，避免配置与业务数据耦合。作业区分短备注 `note`（≤200，行内显示）与长详情 `details`（≤5000，可展开），`details` 为后续 AI 详情摘要预留输入字段。

`core` 层为纯 Rust 数据结构，不依赖 Tauri 类型，便于后续扩展字段与单元测试。

## 标签注册表（迭代 B 第一步）

自定义标签注册表独立持久化于 `app_data_dir/labels.json`（`infra/label_store.rs`，
临时文件 + rename 原子写，损坏备份 `labels.corrupt-<ts>.bak` 并回退空表），
模型为 `core/labels.rs::LabelDef { key, name, icon, color }`：

- **key**：小写 `[a-z0-9-]`、≤32，创建后不可改，是搜索语法与索引存储标识；
  **name** trim 后 1–40 字符且不重复；自定义标签上限 100。
- **icon / color**：预设字符串（前端 `lib/labelDefs.ts` 单一注册表），未知值
  前端回退 Tag 图标 / 中性色；图标与颜色是标签自身属性，不走皮肤；色板 class
  结构与 `FileTypeIcon` 一致，皮肤可整体覆盖。
- **命令与日志**：`list_label_defs` / `save_label_def`（按 key upsert）/
  `delete_label_def`，日志前缀 `labels:`；现有 `list_labels`（索引现存标签）不变。
- **展示规则**：内置 9 大类只读（沿用现有图标与翻译）；筛选行、自动补全标签、
  文件行徽标按注册表显示自定义名称/图标/颜色，未注册标签回退现状；删除标签只删
  注册表，不影响索引历史。

## 受控归档与撤销（迭代 B）

- **系统托管区（跳过集）**：单元根（监控子目录中的项目 + 手动 `project_dirs`）
  与归档根合称跳过集；扫描器与监听器不建索引、不响应事件，历史已索引的跳过集内
  文件一次性标为 deleted（`mark_under_roots_deleted`，幂等）。归档根即使位于监控
  目录内也不会被重新入库，索引由归档操作维护。
- **目标结构**：单文件 `归档根/<大类>/<文件名>`（首标签，未知回落 other，同名自动
  ` (2)` 递增，绝不覆盖）；项目 `归档根/项目/<项目名>`。
- **安全与事务**：同卷 `fs::rename`（跨卷/占用返回明确错误）；索引迁移 + 操作日志
  在同一批内完成，失败则把文件移回，不留半成品；操作写入 `archive_ops` 表
  （`batch_id` 聚合，按批撤销，保留最近 200 批）。批次号由进程内单调分配器生成
  （毫秒时间戳×1000 + 原子递增，同毫秒不合并，无需 schema 变更）；项目归档/撤销
  走统一 `ProjectJournal` 副作用层——settings、快捷方式与目录任一环节失败即完整
  回滚三态（settings 还原、快捷方式目标还原、目录移回），命令层注入 Tauri 实现，
  引擎层以故障注入测试覆盖。
- **命令**：`archive_files`（手动/批量共用引擎）、`archive_filtered`（后端重查，
  仅 indexed、上限 200）、`archive_project`（整目录移动 + `project_dirs` 更新 +
  `shortcuts` 表登记项重建 `.lnk`）、`undo_archive`、`list_archive_batches`；
  日志前缀 `archive:` / `unit:` / `shortcut:`。
- **自动归档**：`ArchiveService` 有界后台队列；监听器新稳定文件入库时，若
  `auto_archive` 开启且分类明确（非 other）则入队；自动批次同样可撤销。
- **前端**：文件页行内归档 + 批量模式（复选）/ 筛选结果归档（危险色确认弹窗）、
  成功横幅带撤销、自动归档常驻提示条（可关闭本次）；项目页归档确认；设置页
  “归档设置”弹窗（根目录、开关、最近归档）。

## 索引、扫描与分类模块（迭代 A.5）

**新增模块与职责**：
- `core/path.rs`：`normalize_path`（统一 `/` 分隔符、去尾斜杠）与 `is_subpath`（组件级包含判定，Windows 小写比较）；所有入库、差集、前缀匹配、目录去重统一走它。
- `core/classify.rs`：`Category` 枚举、`Classifier` trait、`ClassifierChain`（顺序执行 + 跨分类器去重 + 每步 debug 日志）、`ExtensionClassifier`（扩展名→大类映射）；labels 逗号分隔小写 key，字符集 `[a-z0-9-]`，写入前校验。
- `core/query.rs`：`parse_query` 解析 `type:` / `label:`（别名 `tag:`）/ `state:`（别名 `status:`）/ `size:>/<N~M`（B/KB/MB/GB）/ `before:` / `after:`（毫秒时间戳或 `YYYY-MM-DD` 本地时区）与 `sort_by/sort_dir`（name/type/size/modified/labels × asc/desc 白名单）；非法值与未知前缀回落为普通文本；同维度 OR、跨维度 AND。
- `core/scan.rs`：`ScanEvent` / `ScanSummary` / `ScanParams` / `ScanEventSink` / `diff_missing` / `record_from_scan` 纯逻辑。
- `core/index.rs`：`FileEntry` / `FileEnumerator`（遍历契约：path/size/modified/is_dir/is_symlink）与 `ScanDiffStore`（begin/mark_seen/finish 差集契约）接口，`FileRecord` 模型；扫描器与存储层只依赖契约，不依赖具体遍历实现。
- `core/watched.rs`：`check_add`（相等/被覆盖/将覆盖三态）与 `dedupe_watched`（启动自愈）纯函数。
- `infra/scanner.rs`：`ScanService` 串行队列后台扫描，仅依赖 `FileEnumerator` + `ScanDiffStore` 契约；批量事务、进度节流、取消、删除风暴保护、候选二次确认。
- `infra/enumerator.rs`：默认实现为原生 Win32 枚举 `Win32Enumerator`（`FindFirstFileW/FindNextFileW` 直取元数据、不跟随符号链接、应用忽略规则与跳过集、`\\?\` 长路径）；`WalkDirEnumerator` 保留，`ROOTUP_ENUM=walkdir` 可诊断回退；0.8.5 MFT/USN 以独立实现替换，扫描器零改动。
- `infra/startup.rs`：`StartupGate` 延迟非关键服务（watcher/scanner/archive/tray）到前端 `app_ready`（10s 兜底），setup 阶段耗时统一 `startup: <stage> ms=` 埋点。

**依赖注入约定**：`ScanService::new(store, classifier, matcher, params, sink)` 全注入；Tauri 侧仅提供 `TauriScanSink`（emit 前端事件）与分类链组装，业务层零 Tauri 依赖；AI/课程分类 = 新增 `Classifier` 追加进链。

**事件协议**：`scan-progress`（`ScanEvent::Progress`）与 `scan-finished`（Finished/Failed/Cancelled），payload 为 `ScanEvent`（`type` 判别字段）。

**类别单一来源**：`list_categories` 返回静态类别（筛选 Chips 与图标映射），`list_labels` 返回库内动态标签（标签多选），前端不硬编码类别列表。

**错误消息规范**：`模块: 消息` 前缀（如 `scan: 目录不可访问 ...`），命令层透传，测试断言前缀；本轮不引入 thiserror。

**文件安全基线**：扫描只读 metadata；「删除」仅为索引状态标记；`SqliteIndexStore` 用 TEMP 表 + keyset 实现 `ScanDiffStore`（内存 O(批次)），配合删除风暴保护、可用性检查与候选复核构成误判防护；物理归档须启用事务性移动 + 撤销 + 目标存在性检查。

**监听稳定确认**：事件处理器在 `first_sample_delay` 后首次采样，之后按 `sample_gap`
间隔采样大小与可打开性，避免写入中途的短暂停顿被过早判定稳定；超过 `force_timeout`
强制上报兜底。**标签筛选**：`label:` 条件按逗号边界精确匹配（`%,key,%`），杜绝
前缀误命中（如 `course-1` 命中 `course-10`）。

**后续候选**：统计概览（`get_stats`）、`scan_meta` 表、`resources/icons/filetypes/` SVG 源、keyset 分页 / COUNT 治理（0.8.5）、`RwLock` 读写分离、rayon 并行、thiserror、E2E 框架。

## 文件页搜索与筛选

- **搜索为核心**：`components/SearchAutocomplete.tsx` 为搜索框 + 自动补全（combobox），候选来自 `list_categories` / `list_labels` / 固定状态集（状态仅存在于搜索语法与补全，不在界面筛选行），经 `lib/autocomplete.ts` 纯函数匹配与插入（维度前缀补全、子串匹配、替换/追加）。
- **筛选 chips 频率排序**：`FilterBar` 为分类 / 标签两行横向滚动列表（状态筛选不在界面，`state:` 保留给搜索语法），进入页面时按习惯快照排序一次、会话内稳定（已选置前仅体现在高亮与自动滚入视野，不实时重排）；习惯数据由 `hooks/useFilterHabits.ts` 读写（存储见下条）。
- **习惯数据管理**：筛选/补全使用习惯存应用数据目录 `habits.json`（Rust 侧 `core/habits.rs` 校验 + `infra/habit_store.rs` 原子写入与损坏备份 + `commands/habits.rs` 读写），与 settings 完全分离；字段序列化 camelCase（`lastUsed`，兼容旧 `last_used` 读取）；前端 `useFilterHabits` 800ms 防抖合并写盘，启动时一次性迁移旧 localStorage 数据（成功即删除旧键）；恢复默认设置不清空习惯。日志行：`habits: 保存/迁移/损坏回退`。自动补全关键词（`type:` 等）固定顺序，不参与习惯统计；筛选行点击与补全添加标签共用同一习惯键。
- **查询去重**：搜索文本与 chips/自动补全统一汇入 `buildQuery`，按原文 Set 去重后再发送后端。
- **日志约定**：`filter: 切换 kind=... key=... active=...`、`autocomplete: 插入 kind=... key=... token=...`、`filter: 习惯数据损坏已回退`，供冒烟与排查。
- **转义候选**：Windows 文件名不允许冒号，真实文件名不会与 `type:`/`label:` 等语法 token 冲突；未来如需搜索含冒号字符串，在 `parse_query` 增加 `\` 转义（如 `\label:高数` 视为纯文本），本次不实现。
- **弹层样式约定**：锚定/悬浮层（搜索帮助、自动补全下拉、分类映射编辑浮层等）与居中 Modal（设置弹窗、确认弹窗、关闭确认弹窗）统一使用 `floating-panel`——无硬边框，细 ring + `--shadow-float` 双层投影 + 背景模糊 + 半透明底，深浅主题由 `.dark .floating-panel` 适配；`--shadow-float` 为普通 CSS 变量，皮肤可运行时覆盖。锚定/悬浮层追加 `pop-in` 淡入上移动画（约 120ms），居中 Modal 保留遮罩与标题/底部分隔线以维持长内容可读性。新增弹层一律复用该约定，禁止手写边框/投影变体。
- **文本层级与弹窗高度约定**：文本三级语义为 `--text-strong`（页面/弹窗标题）、`--text-secondary`（区块标题，配 `SectionLabel`）、`--text-muted`（说明/计数），工具类 `.text-strong / .text-secondary / .text-muted` 为唯一样式来源，皮肤可运行时覆盖。`Modal` 标题统一 `text-lg`，支持可选 `contentHeight`（内容区 `flex-none` + 固定高度 + 内部滚动）；仅内容可能随交互变化高度或必然超屏的弹窗启用（当前仅分类映射传 `h-[65vh]`），其余弹窗保持自适应，禁止为小弹窗固定高度。
- **按钮顺序约定（Windows 是左否右）**：弹窗底部主操作（保存/确认/删除）在左、取消在最右，统一经 `DialogFooter` 渲染；破坏性操作（如课程表单的“删除课程”）独立置于最左。全应用只允许这一种顺序，新增弹窗禁止手写其它排列。
- **弹窗间距与表单分区约定**：编辑/设置类弹窗内容区分区统一用 `FormSection`（分隔线由分区自身 `border-t` 提供，非首段 `border-t + pt-4`，父容器仅需 `space-y-4`，禁止 `divide-y`——v4 的 divide-y 会把线画在上一个分区底部、紧贴内容）；分区标题为 `text-sm font-semibold text-strong` + 2px 品牌色竖条，字段标签 `text-xs text-secondary`，提示 `text-xs text-muted`。分区内字段间距 `space-y-2.5`、标题到内容 `mt-2.5`。
- **字段宽度语义**：主文本（名称/标题/备注/路径）、独立下拉、单时刻输入、长文本 = 全宽；成对短字段（如老师/地点）= 半宽对；时间段 = `TimeRangeField`（开始/结束 `flex-1` + 连接符）。宽度跟随字段语义，不随网格位置变化。
- **切换控件与圆角刻度**：`SegmentedControl` 支持 `segmented`（默认，`p-1/gap-1`）与 `tabs`（底边线 + 品牌色下划线）两种变体；页面主切换用 tabs（支持 `icon`/`equal`/`badge`，学业页为等宽双栏 + 图标 + 待办数），次级筛选用 segmented。学业页圆角刻度：表格容器 0（方形）、课程卡 4px（rounded-sm）、作业行/空态卡 12px（rounded-lg）、徽章 2px（rounded-xs）。
-- **学业页课程表布局约定**：时间刻度移到表格外左侧页边距（中文 48px / 英文 64px），与整点横线共用 `axisTopPercent` 计算保证对齐，表格内部不再有左列；课程卡 `rounded-sm`、内部徽章与色条 `rounded-xs`；卡片内容按高度降级（≥64px full / ≥40px standard / <40px compact），最小高度 28px。时段排布由 `layoutDayCourses` 承载：时间连通分量 → 贪心分列（同列课程周次互斥）→ 同起止错周课折叠为堆叠卡（层叠边缘 + “共 N 门”角标），点击后每张课程卡作为独立固定元素围绕点击位置摊开（无容器/滚动框/面板，展开期间原堆叠卡隐藏），大卡完整展示信息，最多 4 张并用 +N 收口，deal-in 逐张动效，Esc/点外部/浮动关闭按钮收起；堆叠卡不设更高层级，层叠边缘可轻微越界，由其它课程卡渲染在其上层盖住、不同起止错周课 6px 叠放偏移、同周重叠最多 2 列并折叠为 “+N”（`SlotCoursesDialog` 列出该时段全部课程）；同周冲突卡使用弱玫瑰色描边。点击课程卡打开 `CourseDetailDialog`（完整信息 + 作业列表），编辑/删除/查看作业均需显式操作。
- 学期生命周期：`Semester` 模型（i18n 名称/起止日期/周数），工具栏分层展示——主行 学期选择 + 周步进 + 回到本周，次行 周起始/全部周次；当前周按学期起始推算并可手动预览，`clampWeek` 限制 1..weekCount；学期选择随偏好持久化。
- 学业数据链路（v1：后端 study.json）：`core/study.rs` 模型/校验/种子 + `infra/study_store.rs`（原子写、损坏备份）+ `commands/study.rs`（get/save/exists/reapply）；课程携带稳定 `course-<id>` 标签键；`StudyClassifier` 追加进分类链（完整课程名匹配、长名优先、≥2 字符）；`save_study_data` 保存后执行定向重分类（`IndexStore::all_records/update_labels` 只刷新 labels 列）；旧 localStorage `rootup.study.data.v1` 首次启动一次性迁移并删除；迁移时并入“演示：边界场景”学期。
- 学业截止提醒：判定规则为“自然日差 ≤ lead_days 且未逾期”即临期、差值为负即逾期，仅待办参与；前端 `lib/study.ts`（`isDueSoon`/`homeworkReminderGroup`）与后端 `core/reminder.rs`（`reminder_items`）共用同一语义；`reminder_enabled` 默认关闭、`reminder_lead_days` 1–14（默认 3）。
- 课程标签展示：文件列表/筛选 chips/搜索自动补全通过 `buildCourseLabelDefs` 把 `course-<key>` 映射为课程名与课程色；搜索语法 `label:course-<key>` 直接可用。
- 学业页工具栏布局：主行 = 学期选择/管理/周步进，次行 = 视图切换 + “添加课程”（紧贴课表上方右侧）。
- 长标题边界样例：示例 `c-demo-5`（周二全周）用于目验课表截断、铺开浮层换行、详情全文与筛选 chips 截断。
- 堆叠细节：同列课程按上课顺序排序（开始 → 结束 → 名称）；自动配色优先避开同课时段已有颜色；折叠角标为“图标 + 数量数字”，内容预留右侧空间避免重叠。
- **学业页表单与静默智能约定**：`TimeSelect` 为共享时间选择（5 分钟粒度、portal 到 body + fixed 定位、00:00–23:55 钳制、±5 分钟快捷、Esc/外部点击关闭），替换原生 time/datetime-local；课程表单名称 3/5 + 老师 2/5 同行右对齐、地点独占整行；开始晚于结束时自动按默认 100 分钟调整并钳制 23:55，课程时长快捷项 45/60/90/100/120 分钟；同周重叠实时警告且保存时硬性拦截（合法性校验）；周次范围失焦归一化（全角/空格/“周”字）；作业表单日期 + TimeSelect，选中课程且未手动修改时按 `suggestDueForCourse` 建议截止（30 周内最近上课日 23:59，回退 7 天后），逾期提示不阻断；学业页偏好记忆 localStorage `rootup.study.prefs.v1`（视图/周起始日/全部-当前周），损坏回退默认；跨午夜课程 v1 不支持。
- **自定义下拉契约**：`components/Select.tsx` 为自绘下拉（触发按钮 + portal 到 body + fixed 定位，z-60），定位由 `lib/dropdown.ts` 纯函数计算（最小宽度 240px、视口左右钳制、底部不足向上翻转、最大高度 60vh）；选项结构 `{ value, label, icon?, dotClass?, description?, disabled? }`；支持点击/Enter/Space/↓ 打开、↑/↓/Home/End/Enter 键盘导航、`searchable` 输入过滤（标签+描述子串、大小写不敏感）、Esc 先清词再关闭、外点关闭；短列表（≤7 项）显式 `searchable={false}`；选中项品牌高亮 + Check。原生 `<select>` 已全部替换（9 处），`TimeSelect` 保持独立。
 **输入法保护约定**：所有键盘快捷键处理前必须判断 `isComposing(event)`（`lib/ime.ts`，兼容 React 合成事件与原生事件），拼音组合期间一律放行给输入法；`useImeGuard` 在 App 根部挂载，窗口失焦时释放编辑元素焦点以结束残留组合。新增键盘监听必须遵循，禁止在组合期间拦截按键。
- **测试策略与设施**：纯逻辑（lib/、core/、infra/）用 vitest / cargo test 覆盖；组件与 hooks 用 `@testing-library/react` + jsdom 覆盖交互边界（键盘协议、弹窗开关、分页合并、事件状态机），mock 约定为 `vi.mock("../lib/tauri")` 与 `vi.mock("@tauri-apps/api/event")`，测试设施全部位于 devDependencies，不进入生产产物。新增组件测试照此扩展，禁止跳过关键交互边界。
- **基准协议（可复现/可比较）**：`bench-all.ps1 -Full` 是唯一入口，先跑确定性语料自检（同 seed 200 文件 × 2 哈希一致）再跑引擎/系统基准；结果 JSON 必含扩展 host 指纹（os/cpu/rustc/node/npm/ram_gb/commit）与 schema=2；`render-benchmarks.ps1` 只对同指纹版本计算 delta 与 15% 警示，跨主机/缺指纹/legacy v1 标记不可比；基线 JSON、README 对比表与 SVG 随版本提交，后续版本只追加不覆盖。
- **日志与校验约定**：前端行为日志统一 `ui: ` 前缀（如 `ui: 刷新`、`ui: 加载更多 offset=N`、`ui: 清空搜索`、`ui: 取消扫描`），后端子系统沿用各自前缀；`settings: 加载` 由 `get_settings` 输出，冒烟脚本据此断言。`scripts/check-arch.ps1` 校验 `pages → features → components/hooks → lib` 单向依赖（同层仅允许 features/components/hooks/lib 互引），以 `npm run check:arch` 运行并在 CI 强制。
- **AddDirOutcome 契约**：`add_watched_dir` 返回 `{ message, dir }`，其中 `dir` 为规范化后的路径；前端必须用返回值同步列表，不得回显用户输入原文（避免大小写/斜杠不一致）。
- **项目识别与智能打开**：`core/project.rs` 提供 `ProjectKind`/`ProjectInfo`/`ProjectDetector` trait（AI 后续 = 新实现插入）、`FeatureDetector` 特征表（优先级 Unity→Flutter→Android→Kotlin→Rust→Go→Java→C#→Node→Python→Cpp→PHP→Ruby→Dart→Swift；`detect_project_kind_with_feature` 返回命中特征文件名）、`find_project_root`（文件向上找项目根，最多 5 层，跳过噪音目录名）与 `discover_projects`（watched 子目录 + 手动目录，跳过噪音目录；`ProjectInfo` 携带 `source: manual|auto` 与 `detectedBy`）。`core/tools.rs` 是“打开意图”单一来源：项目类型 → IDE 候选、扩展名 → 工具候选（md/ipynb/matlab/origin/mathematica/multisim/proteus/cad/solidworks/ps/ai/tex），Office/PDF 与未映射类型走系统默认。`infra/app_finder.rs` 应用查找顺序：自定义命令（`tool` 匹配优先，空 = 通用兜底）→ PATH 命令名（含 `.exe`）→ Windows App Paths 注册表（winreg）→ 内置常见路径（支持单段 `*` glob）→ 系统默认打开；`CommandRunner` trait 隔离进程启动（Windows 下统一附加 `CREATE_NO_WINDOW`，`cmd /C` 包装 `.cmd/.bat` 时不再弹控制台窗口，目标 GUI 窗口不受影响）。`infra/shortcut.rs` 生成 `rootup.exe --open-project <path>` 的 `.lnk`（重名递增、内嵌图标缓存；新项目类型暂用 generic.ico）。启动参数 `--open-project` 在首次启动（setup）与单实例回调中解析并 emit `project-open`。
- **日志前缀**：`project: 添加/移除/发现/启动参数打开`、`ide: 打开/回退`、`open: 文件/定位/默认`、`shortcut: 创建`、`tools: 意图`（预留）；前端行为统一 `ui: `（打开项目/文件/定位/创建快捷方式/添加移除项目）。

## 扩展点

- **多语言**：在 `src/i18n/locales/` 新增语言文件，并在 `core/settings.rs` 的校验常量中登记语言代码。
- **主题**：三态（跟随系统/浅/深）由 `theme/ThemeProvider.tsx` 管理，`matchMedia` 监听系统变化。
- **皮肤**：皮肤 = 一套令牌 + 全局变量 + 组件变体的整套覆盖。默认皮肤由三部分组成：`theme/tokens.css` 的 `@theme` 品牌令牌（颜色/圆角/阴影）、`styles/global.css` 的全局 CSS 变量（滚动条色、`--shadow-float`、文本三级变量）、共享组件变体（`Button` 的 variant / `Banner` 的 variant / `Chip` 的 variant / `IconButton` 的 tone）。新增皮肤时整体替换/叠加即可，组件逻辑零改动；v1 仅提供 default。
- **共享交互组件**：`components/Button.tsx`（primary/secondary/danger/amber/ghost × xs/sm/md，样式等价映射见组件内注释与 README）、`components/Banner.tsx`（brand/warn/error，可选关闭）、`components/IconButton.tsx`（xs/sm/md × neutral/danger/brand/inherit，统一图标按钮与 × 悬停反馈）、`components/Chip.tsx`（sm=h-6 / md=h-7 × neutral/active/brand/selectable，支持 icon/badge/onRemove/onClick，文件页与设置弹窗共用）、`components/SectionLabel.tsx`（sm/xs 两级区块标题）、`components/ConfirmDialog.tsx`（基于 Modal 的确认弹窗）、`components/ConfirmButton.tsx`（两步确认状态封装）、`components/Field.tsx`（标签 + 提示 + 控件）、`components/ColorPicker.tsx`（12 色板 + 可选“自动”，标签/课程共用）、`components/DialogFooter.tsx`（弹窗底部按钮容器）、`components/DirectoryAdder.tsx`（目录添加器：文字输入清洗 + 原生浏览 + 拖拽（可解析文件父目录）+ 常用目录 chips + 错误提示，设置页与项目页共用）。所有新页面优先复用，禁止复制手写变体。
- **基础表单与状态组件**：`Input`（sm/md，统一边框/聚焦/深浅色）、`Select`（自绘下拉，见“自定义下拉契约”，不再渲染原生 select）、`InlineNotice`（success/error/info）、`EmptyState`、`PageHeader`、`SyntaxTable`（语法行单一来源）、`FormSection`（分隔线表单分区：标题 + 可选描述 + 内容，配合父容器 `divide-y`）、`TextArea`（与 Input 同令牌的多行文本域）均为共享组件；新增输入/提示/空态/页头/分区/长文本一律复用，禁止手写等价样式。
- **动效令牌与微交互**：`tokens.css` 定义 `--duration-fast/base/slow` 与 `--ease-out/in-out`；`global.css` 提供 `.micro-press`（按压轻缩）与 `.list-enter`（列表项入场），并全局 `prefers-reduced-motion` 降级；新动画一律引用令牌，仅 transform/opacity，禁止散落硬编码时长。
- **悬浮提示契约**：`components/Tooltip.tsx` 为唯一悬浮提示组件（portal 到 body 防裁剪、位置/延迟/Esc 关闭、移出关闭）；IconButton 的 `label` 自动生成 tooltip 与 aria-label；提示内容优先 i18n。
- **清理原语与可靠性预留**：移除监控目录即调用 `mark_under_roots_deleted`（作为 v0.8.8 分类变更日志的“删除事件”来源）；启动归档对账挂载在 `app.rs setup` 紧随 `refresh_managed_state`；`local_file` 临时文件统一 `*.json.tmp` 供启动清理；`archive_ops` 的 source/dest/undone_at 结构即对账依据（v0.8.8 实现，本轮只固化约定）。
- **帮助中心与新手引导**：`HelpCenterProvider` 全局装配（侧栏入口 + 首次欢迎 + 五分区帮助弹窗：新手入门 / 任务指南 / 搜索语法 / 设置说明 / 遇到问题）；内容单一数据源为 `lib/helpContent.ts` 注册表（文章、更新亮点、搜索源），文案一律 i18n key 且 zh/en 成对；帮助内搜索为 `lib/helpSearch.ts` 纯函数（标题 > 关键词 > 摘要，稳定排序）；文章反馈走 `lib/helpFeedback.ts` 本地存储（`rootup.help.feedback.v1`，不上传）；首次欢迎用 localStorage `rootup.onboarding.v1` 一次性标记，帮助中心可重看；IDE 指导数据在 `lib/ideGuide.ts`（仅官方链接）；后端 `list_detected_tools` 返回已检测工具 key，`open_url` 仅允许 https 且命中 `core/tools.rs` 白名单域名（`ALLOWED_DOWNLOAD_DOMAINS`），非法 URL 拒绝并记日志。
- **打包与发布约定**：`tauri.conf.json` 启用 NSIS（`installMode: currentUser`、中英语言选择、开始菜单 RootUp），图标由 `npm run tauri icon resources/icons/rootup-sprout.svg` 生成全套；发布前必须 `npm run check:version` 全绿（规则见"版本号规则与发布纪律"）；发布验证统一走 `scripts/verify-installer.ps1`（静默安装 → 冒烟 → 卸载），日常 CI 为 `ci.yml`（构建 + smoke + 架构校验），发布为 `release.yml`（打 `v*` tag 构建安装包 → 验证 → 上传 GitHub Release）；不签名、不启用 updater，SmartScreen 提示写入发布说明。
- **新页面**：在 `pages/` 新增页面，注册到 `Sidebar` 的导航项与 i18n 文案；当页面长出多个私有组件时，提级为 `features/<name>/components/`（页面级组件与测试），`pages/` 只保留入口。
- **托盘菜单与图标**：在 `infra/tray.rs` 中扩展菜单项与事件处理。菜单模型由纯函数生成（`core/tray_menu.rs`：临期/逾期作业前 8 项、自动归档与主题勾选态、tooltip 计数；`tray_icon_has_badge` 判定红点角标），在启动、`save_study_data`、`set_settings` 后经 `refresh_tray` 动态重建（`TrayIcon::set_menu/set_tooltip/set_icon`），不轮询；图标资产为 `resources/icons/rootup-tray.ico` 与 `rootup-tray-badge.ico`（16/20/24/32/48/64 多帧）及 `rootup-menu-open/quit.png`（16px 菜单图标），由 `scripts/generate-tray-icons.ps1` 构建期生成并提交，运行时零依赖；临期/逾期计数 > 0 时切换红点版；“打开 / 退出”使用 `IconMenuItem`（Windows 位图图标），勾选项（自动归档/主题）与子菜单本身不支持图标、保持文字；左键单击打开主窗口；临期作业项与 `--open-homework` 启动参数均通过 `study-homework-open` 事件深链到学业页（App 层监听并转发一次性 `focusHomework` 意图）。深链聚焦规则：`--open-project` 不聚焦前台（热唤起不调起窗口、首次启动隐藏主窗口驻留托盘，仅打开 IDE/资源管理器并后台切到项目页），`--open-homework` 与普通启动保持聚焦。
- **后端命令**：在 `commands/` 新增模块，并在 `app.rs` 的 `invoke_handler` 中注册。

## 演进规则

- `components/` 只放跨功能可复用的组件；页面私有组件随功能生长到 `features/<domain>/components/`，禁止在 `features/<domain>/` 根目录散放 UI 文件。
- 新增依赖前先评估必要性（轻量原则）；当前不引入路由、状态管理等非必要库。
- 保持单向依赖，代码审查时以本文件依赖图为基准。

## 0.8.4 前置修复契约

- **托管状态刷新**：`refresh_managed_state` 已迁至 `infra/managed_state.rs::refresh`，`app.rs` 仅保留组合装配；`commands/`、`infra/tray.rs` 均通过 `infra::managed_state` 调用，禁止再回指 `app.rs`。`QuitFlag` 同迁至 `infra/window.rs`。
- **Rust 分层门禁**：`scripts/check-rust-arch.ps1`（`npm run check:arch:rust`，CI 强制执行）校验：`core` 生产代码不得引用 `tauri`/`crate::infra`/`crate::commands`/`crate::app`；`commands` 不得引用 `crate::app`；`infra` 不得引用 `crate::commands`/`crate::app`；扫描时剔除注释、字符串与 `mod tests` 块。
- **设置写入盖章**：`Settings::normalize()` 将 `version` 恒置为 `CURRENT_VERSION`；`set_settings` 必须先 normalize 再校验/保存，前端不参与版本持久化。
- **归档原子化**：`IndexStore::archive_record(from, to, op)` 与 `unarchive_record(from, to, op_id)` 必须单事务完成（记录迁移 + 日志插入 / undone 标记）；引擎层在 DB 失败时回滚磁盘 rename；撤销逐项即时标记，不允许“最后统一批量标记”的中间窗口。
- **重命名语义**：`RenamedFrom` 对 indexed/archived 记录视为旧路径删除（`next_state` 迁移到 deleted）；pending 记录仅移除待确认项。rename 配对迁移属于 0.8.4 `DeltaSource` 职责，前置修复只保证不残留旧路径。
- **默认规则单一来源**：后端默认忽略规则唯一来源为 `Settings::default().ignore_rules`，`IgnoreMatcher::new()` 由其构造；前端 `DEFAULT_IGNORE_RULES`（`lib/tauri.ts`）与 `fixtures/default-ignore-rules.json` 保持同步并由双端测试断言。
- **共享一致性 fixtures**：`fixtures/` 下的 JSON 由 Rust（`include_str!`）与 TS（JSON import）共同消费；新增跨语言语义（如提醒分组、默认值）一律先落 fixture 再实现/断言，不引入代码生成工具链。
- **公共时间工具**：Unix 毫秒时间戳统一走 `infra/time.rs::now_millis()`，禁止各 infra 模块重复实现。

## 0.8.5 前置帮助中心契约

- **页面帮助入口**：`PageHeader` 的 `actions` 为可选插槽，不传时渲染结构与历史版本完全一致（标题 + 描述）；四个主页面（文件 / 项目 / 学业 / 设置）经 `PageHelpButton` 传入文章 id 或分区 id 打开帮助。`PageHelpButton` 使用“Info 图标 + 文字”的帮助按钮，与搜索框内“?”语法帮助在视觉上明确区分（语义也不同：本页指南 vs 搜索语法），同页不出现两个问号图标。`PageHeader` 保持通用，禁止 import 任何帮助内容。
- **帮助内容注册表**：新增一篇帮助文章 = `lib/helpContent.ts` 注册一项 + i18n 双语 key，组件零改动；文章 id（如 `tasks.files`）是稳定深链契约，供搜索、页面入口、相关条目与未来 v1.2 知识库 / v1.4 语言包复用。文章字段（title/summary/steps/keywords/related/action）由测试强制校验，禁止绕过注册表在组件内硬编码文案。
- **帮助内搜索**：`lib/helpSearch.ts` 纯函数，仅消费注册表聚合的 `HELP_SEARCH_SOURCES`；不得引入全文检索依赖，也不得在 UI 层自行实现匹配逻辑。
- **反馈边界**：`lib/helpFeedback.ts` 只依赖 localStorage，无后端接口；未来接入 0.8.10 动作日志 / 诊断包时替换该模块实现，UI 层不感知。
- **文案质量门禁**：帮助相关 i18n 命名空间（`help*`）禁止 AI 腔表达与内部实现标识符，由 `lib/helpCopy.test.ts` 与 i18n 双端 key 一致性测试强制；写作规范见 `docs/COPYWRITING.md`。

## 0.8.5 契约（快速扫描与查询）

- **查询分页**：`FileQuery.cursor`（不透明 keyset 游标，JSON `[排序值, id]`）优先于 OFFSET；`QueryPage.next_cursor` 表示还有下一页（多取一行探测）。排序恒为 `ORDER BY <白名单列> <dir>, id DESC`，游标类型必须与排序列一致，否则查询被拒。
- **COUNT 治理**：`FileQuery.need_total=false` 时 `total=-1`；命令层默认仅“首页且无筛选”返回精确总数；归档批量上限等内部查询显式置 `need_total=true`。
- **显式 AND 语法**：`+label:v` 与 `label:a AND label:b`（AND 大小写不敏感、仅相邻标签生效、孤立 AND 回落普通文本）解析进 `labels_all`，SQL 逐条 LIKE 且 AND 连接；同维度默认 OR 语义不变。解析契约见 `core/query.rs` 单测。
- **索引集（实测收窄）**：`files` 表仅保留 `idx_files_state(state, deleted_at)`、`idx_files_modified(modified)`、`idx_files_type(file_type COLLATE NOCASE)`；`name/labels` 为前导通配 LIKE 无法利用索引，`state_modified` 组合索引在 `state !=` 范围下不支撑 ORDER BY，均为写放大已删除。存量库经 schema v4 迁移（`user_version` 3→4）幂等收敛旧索引；新增索引必须经过基准决策门。
- **NTFS 快速扫描**：`infra/ntfs.rs` 提供卷能力探测、USN 记录解析与路径重建；快速全量路径由 `ROOTUP_FAST_SCAN=1` 显式开启且 probe（NTFS + USN 完整 + 权限）全部通过才生效，任何失败回退 `WalkDirEnumerator` 并记录 `scan: 快速扫描不可用 ...`；USN 无文件大小，快速路径逐文件补元数据；MFT 基线顺延 0.8.6（决策见 `benchmarks/mft-usn-evaluation.md`）。
- **分类匹配**：课程分类器使用 Aho-Corasick 重叠匹配保持“包含即命中”语义（见等价测试）；忽略规则因语义（前缀/精确/包裹）不适用 AC。
- **性能基准契约**：0.8.5 起对比目标为“0.8.5 vs 0.8.4”单轨；新增指标 `query_keyset_page` / `query_labels_multi` / `query_and_syntax` / `query_and_keyword` / `query_label_json` / `query_text_fts`；标签与文本实现评估结论见 `benchmarks/label-index-evaluation.md`。

## 0.8.6 阶段一契约（已收口）

- **增量契约**：`core/delta.rs` 定义 `DeltaKind` / `DeltaRecord` / `DeltaSource`（begin / next / commit）；USN 实现 `infra/usn_delta.rs`，重命名按“旧路径删除 + 新路径创建”展开（与 0.8.4 收敛语义一致），未来 0.8.8 配对迁移可直接替换映射。
- **USN 状态**：`IndexStore` 提供 `get_last_usn` / `set_last_usn` 默认无操作，SQLite 实现持久化到 `usn_state`（schema v5，按卷一行）；启动补账线程（`startup.rs`）无基线时记录当前 USN，有基线时执行 `(last, current]` 增量，失败只记录不阻塞。
- **MFT 枚举器**：`infra/mft.rs` 实现 `FileEnumerator` 语义的全量扫描（FILE 记录解析 + 主名策略 + 路径重建），`ROOTUP_MFT_SCAN=1` 且管理员/NTFS 才启用，失败回退 walkdir；扫描器日志统一 `scan: 快速扫描不可用 ... 回退 walkdir`。
- **FTS5**：`files_fts` 为 contentless + trigram（schema v6 版本占位，**默认不建表**）；实现与测试保留，同步点同事务（upsert / delete / move / purge，标签不索引），表缺失时自动跳过；查询仅当索引就绪且所有词 ≥3 字符时走 FTS，其余回退 LIKE。启用条件见 `benchmarks/fts-evaluation.md`。
- **索引集（v7 复核）**：`files` 索引收敛为 `idx_files_state(state, deleted_at)` + `idx_files_modified(modified)`；`idx_files_type` 因同轮对比无收益且增加写放大，经 schema v7 幂等移除。
- **目录缺失对账**：`core/path.rs::is_missing_dir_error`（Windows os error 2/3）判定后才 `mark_under_roots_deleted`；扫描失败与启动探测共用；命令 `watched_dir_health` 供设置页标记缺失目录（不删除记录，重扫可恢复）。
- **基准契约**：阶段一新增 `engine_index_build_*_with/without_type_ms`、`engine_query_type_with/without_type_ms`、`engine_reapply_labels_*` 变体；阶段一验证不落库，完整 0.8.6 官方基线在阶段二完成后统一生成。

## 0.8.6 扫描优化（已收口）

- **MFT 全量读取**：按 `$MFT` 记录 0 的 $DATA 映射对（长度在前、LCN 增量在后，参考 ntfs-3g `runlist.c`）分 run 流式读取（32MiB 块 + `FILE_FLAG_SEQUENTIAL_SCAN` + 跨 run 缓冲拼接），不假设 MFT 连续；USA fixup 原地应用，不逐条复制缓冲。
- **紧凑索引与子树定向**：解析即压缩为目录表（记录号 → (主名, 父记录号)）与文件表（记录号 / 名称 / 父 / 大小 / 修改时间），不保留全量 MFT 记录；按监控根路径段定位根记录后 BFS 子树，只产出子树内文件；定位失败回退全量父链解析 + 前缀过滤，保证不丢结果。
- **大小兜底**：attribute-list extent 未解析到 `$DATA` 大小时（`size_known=false`），产出阶段按路径补查一次元数据，仅异常项，失败回退已解析值。
- **skip_roots 对齐**：MFT 与 walkdir 一致应用跳过集（项目根 / 归档根整棵不索引）；真实目录 71,923 文件两侧数量全等（0 walk-only / 0 mft-only）。
- **USN 访问级别**：卷句柄要求 `FILE_READ_DATA`（`FILE_READ_ATTRIBUTES` 导致 `FSCTL_QUERY_USN_JOURNAL` 返回 0x80070001）；`FSCTL_READ_USN_JOURNAL` 必须携带真实 `UsnJournalID`（否则 0x80070057）。修复后本机启动补账可用。
- **DB 批量**：`ScanParams.batch_size` 默认 2000；`upsert_many` 多行 VALUES（子批 1000）+ 冲突更新（first_seen 不覆盖）；FTS 未启用时表存在性只检查一次；扫描日志新增 `db_ms`，MFT 阶段新增 `read_ms / parse_ms / resolve_ms`。
- **walkdir 微优化**：跳过集与时间戳在枚举开始时快照一次（不再逐目录加锁/取时钟），忽略规则与符号链接语义不变。
- **默认枚举器转正**：原生 Win32 枚举成为扫描默认（全链路等价 PASS：合成 1k/10k/50k + 真实 Desktop 71,923，DB 集合零差异；50k 12.6x、真实 4.3x）；`ROOTUP_ENUM=walkdir` 诊断回退。
- **MFT 读取策略（0.8.6 实验结论）**：默认 **parallel**（按记录对齐字节范围分线程读+解析再合并，`ROOTUP_MFT_PARALLEL` 控制线程数默认 4），read_ms 约 -27%（2.3–2.5s vs 3.3–3.4s），三语料严格零差异；`ROOTUP_MFT_READ=sequential` 诊断回退。mftfile（`$MFT` 文件直读）本机打开被拒已移除、nobuffer 无收益已移除；解析/紧凑索引/子树逻辑对所有读取策略完全复用，验证见 `benchmarks/mft-read-variants.md`。
- **扫描选择优化器**：`core/scan_choice.rs` 双线性模型（MFT 固定成本 = 最近 `read_ms`，随整卷文件表大小缩放；`mft_per_file` / `native_per_file` 由最近扫描实测校准）；交叉点 `N* = fixed/(native_per - mft_per)`，`per_native <= per_mft` 时原生恒优；启用带 1.25× 迟滞。扫描器在 `ROOTUP_MFT_SCAN` 开启时按上次索引根计数决策，并把每次扫描的耗时/`read_ms` 回写校准（`scan: 快速扫描决策` 日志）；系数随 HDD/SSD 与目录结构自动适应，不预设固定阈值。
- **诊断强制开关**：`ROOTUP_MFT_FORCE=1`（与 `ROOTUP_MFT_SCAN=1` 同时设置时）跳过优化器迟滞直接走 MFT，仅用于验证脚本的 walkdir / native / MFT / 优化器四态受控对比；失败仍回退原生枚举，默认发布路径不受影响。
- **交叉点实验**：1k/10k 时 walkdir 胜出（MFT 需读全卷 2.6GB 固定成本）；50k 起 MFT 稳定胜出；20k/30k 边界受语料冷缓存影响有噪声，阈值待 25k 确认；MFT 默认策略仍不启用，切换动作留待后续里程碑。
- **jwalk 复评**：deep/wide 语料实测未达“收益 ≥30%”门槛（相对 walkdir 仅 wide +13%、deep -16%，相对原生慢 8.8–11.9 倍），不引入；原型已移除，见 `benchmarks/jwalk-evaluation.md`。
