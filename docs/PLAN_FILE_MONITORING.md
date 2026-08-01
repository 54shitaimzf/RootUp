# 文件监听与索引 实施计划（迭代 A 修订版）

> 本文档是迭代 A 的执行依据；设计背景见 [FILE_MONITORING.md](FILE_MONITORING.md)。

## 一、目标与范围

**目标**：打通"文件落地 → 索引分类 → 文件页浏览"全链路；监控目录可在设置页管理并持久化；
日志系统作为独立模块落地，供所有子系统写入。

**本次实现**：

- 监控目录设置（`Settings.watched_dirs`，增删、重启保留）
- 监听管道（notify + 事件归一 + 去抖 + 忽略清单 + 稳定确认 + 状态机）
- SQLite 索引库（`IndexStore` trait 解耦）
- 文件页（实时列表、搜索、状态徽标）
- 日志系统（`core/log` 契约 + `infra/logging` 文件实现，滚动）
- 前端 `log_event` 命令（前端错误进入同一日志系统）

**本次不做（迭代 B）**：打开/桌面快捷方式、自动归档、分类建议弹窗、指定程序打开、
单元分类树、撤销与路径跟随。`opener`、`mslnk` 依赖本轮不引入。

## 二、架构与数据流

```
notify 事件 → infra/watcher（归一 + 去抖 + 稳定确认）
            → core 状态机判定 → infra/index_store（SQLite）
            → Tauri 事件广播 → 前端文件页实时更新

日志：任意模块 → log facade → infra/logging（文件滚动 + debug 终端输出）
```

**模块落点**（新增文件，不破坏现有分层）：

- `src-tauri/src/core/events.rs`：归一化事件模型、`FileState` 状态机、稳定确认判定（纯函数）
- `src-tauri/src/core/ignore.rs`：忽略规则（临时扩展名/前缀），纯函数
- `src-tauri/src/core/index.rs`：`FileRecord` 模型 + `IndexStore` trait
- `src-tauri/src/core/log.rs`：日志契约（级别、模块、写入接口）
- `src-tauri/src/infra/watcher.rs`：notify 接入、去抖队列、稳定确认任务、事件广播
- `src-tauri/src/infra/index_store.rs`：SQLite 实现（`Mutex<Connection>` + WAL）
- `src-tauri/src/infra/logging.rs`：文件日志实现（1MB 滚动 × 3）
- `src-tauri/src/commands/files.rs`：监控目录管理、文件查询、`log_event`
- 前端：文件页真实列表、设置页监控目录区块、`lib/tauri.ts` 扩展、i18n 文案

**线程模型**：notify 回调线程只投递事件（有界 channel，容量 1000，溢出记日志丢弃）；
独立处理线程做归一/去抖/稳定确认并写库、广播；前端查询走命令（同步）。

## 三、关键设计决策

| 决策点 | 选择 | 说明 |
| --- | --- | --- |
| 监听库 | `notify`（最新版） | API 以本地 crate 源码为准，不符先查源码再改 |
| 索引存储 | `rusqlite`（bundled），`app_data_dir/rootup.db` | 条目增长后 JSON 不可靠；trait 解耦可换 |
| 日志 | `log` crate facade + 自实现文件 Logger | 标准 facade，模块只依赖 `log::info!` 等宏 |
| 稳定确认 | rename 立即完成；create 后 3s 首次采样、1s 后二次采样，大小一致且可打开 → 稳定；60s 超时强制上报 | 参数集中在 `core/events.rs` 常量 |
| 去抖 | 2 秒窗口合并为一次批量事件 | 防解压/拖拽风暴 |
| 忽略清单 | `.crdownload .part .download .tmp .temp`、`~$`、`#…#` 前缀 | 集中常量表，后续可配置化 |
| 索引表 | `files(id, path UNIQUE, name, size, file_type, labels, first_seen, modified, state)` | state: `pending/indexed/archived/deleted`；UI 默认只显示存在文件 |
| 日志文件 | `app_data_dir/logs/rootup.log`，1MB 滚动 × 3，格式 `时间 [级别] 模块 消息` | debug 模式同时输出终端 |
| 前端列表 | 最近 200 条 + 名称搜索 | 轻量，不做虚拟滚动 |

## 四、实施步骤（原子、可验证）

**步骤 0：依赖接入**

- Cargo.toml 增加 `notify`、`rusqlite`（bundled）、`log`。
- 验证：`cargo check` 通过（首次编译较慢，预计 5–10 分钟）。

**步骤 1：core 纯逻辑层**

- 实现 `events.rs`（归一、状态机、稳定判定）、`ignore.rs`、`index.rs`（模型 + trait）、`log.rs`（契约）。
- 单测：忽略规则命中/放行；状态迁移合法/非法；稳定判定（大小变化/可打开/超时）；归一化收敛（create+write+rename）。
- 验证：`cargo test` 全绿，`cargo clippy -D warnings` 无告警。

**步骤 2：SQLite 索引库**

- 实现 `IndexStore`（建表、upsert、按 path 查询、列表、搜索、状态更新）；路径经应用数据目录。
- 单测：临时库 CRUD、upsert 幂等、搜索过滤。
- 验证：`cargo test` 全绿。

**步骤 3：日志系统**

- 实现 `infra/logging.rs`（级别过滤、文件写入、滚动、终端镜像）；setup 时初始化并接入。
- 各模块接入 `log::info!/warn!/error!`（监听、索引、命令层）。
- 单测：临时文件写入、滚动触发、级别过滤。
- 验证：`cargo test` 全绿。

**步骤 4：监听管道**

- `watcher.rs`：目录增删监听、递归模式、事件回调投递、去抖合并、稳定确认、写库、`emit("files-changed", …)`。
- 集成测试：临时目录 + notify，放文件后轮询索引库出现记录（超时 15s）；放 `.crdownload` 不产生记录。
- 验证：`cargo test` 全绿（含集成测试）。

**步骤 5：命令层与设置扩展**

- `Settings` 增加 `watched_dirs: Vec<String>` + 校验；`add_watched_dir` / `remove_watched_dir` 同步更新设置与监听；
  `list_files`、`log_event` 命令注册。
- 验证：`cargo check`、`cargo clippy`、`cargo fmt --check` 全绿。

**步骤 6：前端**

- 设置页：监控目录列表（添加路径、移除、状态）；文件页：实时列表、搜索、状态徽标；`lib/tauri.ts` 类型化封装；中英文案。
- vitest 纯函数测试（列表过滤、状态判定、i18n 资源完整性）。
- 验证：`npm test`、`npm run build` 通过。

**步骤 7：全量验证与提交**

- `cargo test / clippy / fmt --check`、`npm test / build`、`tauri build --no-bundle` 全绿。
- 冒烟清单（见下）；git 提交（如 `feat: 文件监听、索引与日志系统`）。

## 五、测试策略

- Rust：core 纯逻辑单测、索引库临时库单测、日志滚动单测、监听管道集成测试（临时目录轮询断言）。
- 前端：vitest 仅测纯函数（列表过滤、状态判定、i18n 完整性）。
- 构建：cargo test/clippy/fmt + npm test/build + tauri build --no-bundle。
- 人工确认边界：窗口内真实点击交互不做自动化（成本过高），最终留 2 分钟视觉确认清单，
  其余由执行者自动验证。

## 六、验收冒烟清单

1. 设置页添加目录 → 重启应用 → 目录仍在且监听生效。
2. 往监控目录丢文件 → 5 秒内文件页出现（名称/类型/时间/状态）。
3. 丢 `.crdownload` 临时文件 → 不出现或标记"下载中"，最终以正式名出现。
4. 解压 zip（大量文件）→ 不卡顿，列表批量更新。
5. 文件页搜索 → 结果正确过滤。
6. 用户手动删除文件 → 条目消失（或标记删除），不弹窗打扰。
7. 日志文件产生且包含监听/索引记录；深色模式与中英切换正常。

## 七、防执行幻觉措施

- 先查证再编码：notify/rusqlite/log API 以本地 crate 源码为准，编译报错先读源码再改。
- 每步独立验证：不跨步"顺带完成"，红则停。
- 参数集中：超时/去抖/忽略清单全部在常量模块，杜绝魔法数字。
- 小步提交：步骤 4 完成后可先提交（`feat: 文件监听管道与索引库`）。
- Windows 实测：占用检测等行为必须在 Windows 环境验证。

## 八、发挥空间（迭代 B 及以后）

- 打开/桌面快捷方式：复用索引条目，`OpenMethod` 模型届时引入。
- 自动归档与分类建议：复用索引与状态机。
- 忽略清单与去抖参数：后续做进设置页。
- 单元机制：文件记录已有 path/name 字段，文件夹单元后续加 `is_unit` 标记。
- 日志：后续可加日志查看页、远程上报（模块接口不变）。
