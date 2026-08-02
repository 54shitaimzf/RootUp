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
│   ├── pages/                    # 页面层：Files / Homework / Courses / Tools / Settings
│   ├── components/               # 通用 UI 层：Sidebar、CloseConfirmDialog、PagePlaceholder
│   ├── hooks/                    # 通用逻辑层：useSettings
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

## 设置数据流

`Settings { theme: system|light|dark, language: zh-CN|en }`

```
前端 lib/tauri.ts → invoke → commands/settings.rs（校验）
                    → infra/storage.rs（tauri-plugin-store，settings.json）
                    → core/settings.rs（模型与默认值）
```

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

## 扩展点

- **多语言**：在 `src/i18n/locales/` 新增语言文件，并在 `core/settings.rs` 的校验常量中登记语言代码。
- **主题**：三态（跟随系统/浅/深）由 `theme/ThemeProvider.tsx` 管理，`matchMedia` 监听系统变化。
- **皮肤**：皮肤 = 一套设计令牌。默认皮肤为 `theme/tokens.css` 的 `@theme` 变量；新增皮肤时替换/叠加令牌即可，组件零改动。
- **新页面**：在 `pages/` 新增页面，注册到 `Sidebar` 的导航项与 i18n 文案；当页面长出多个私有组件时，提级为 `features/<name>/`（自包含组件 + hooks + API），`pages/` 只保留入口。
- **托盘菜单**：在 `infra/tray.rs` 中扩展菜单项与事件处理。
- **后端命令**：在 `commands/` 新增模块，并在 `app.rs` 的 `invoke_handler` 中注册。

## 演进规则

- `components/` 只放跨功能可复用的组件；页面私有组件随功能生长到 `features/`。
- 新增依赖前先评估必要性（轻量原则）；当前不引入路由、状态管理等非必要库。
- 保持单向依赖，代码审查时以本文件依赖图为基准。
