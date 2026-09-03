# 版本契约存档（CONTRACTS）

> 本文件归档历史版本的契约快照，反映**当时的**设计与决策状态；现行约定以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。
> 归档规则：每个版本收口后，ARCHITECTURE.md 中该版本的临时契约段落移入此处；其中仍然有效的规则会并入正文对应主题，其余仅作历史记录。
> 实验、基准与决策的完整数据见 `benchmarks/` 下的评估文档与 [docs/reports/](reports/)。

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
- **索引集（实测收窄）**：`files` 表仅保留 `idx_files_state(state, deleted_at)`、`idx_files_modified(modified)`、`idx_files_type(file_type COLLATE NOCASE)`；`name/labels` 为前导通配 LIKE 无法利用索引，`state_modified` 组合索引在 `state !=` 范围下不支撑 ORDER BY，均为写放大已删除。存量库经 schema v4 迁移（`user_version` 3→4）幂等收敛旧索引；新增索引必须经过基准决策门。（后续 v7 复核又移除了 `idx_files_type`，见 0.8.6 契约。）
- **NTFS 快速扫描**：`infra/ntfs.rs` 提供卷能力探测、USN 记录解析与路径重建；快速全量路径由 `ROOTUP_FAST_SCAN=1` 显式开启且 probe（NTFS + USN 完整 + 权限）全部通过才生效，任何失败回退 `WalkDirEnumerator` 并记录 `scan: 快速扫描不可用 ...`；USN 无文件大小，快速路径逐文件补元数据；MFT 基线顺延 0.8.6（决策见 `benchmarks/mft-usn-evaluation.md`）。
- **分类匹配**：课程分类器使用 Aho-Corasick 重叠匹配保持“包含即命中”语义（见等价测试）；忽略规则因语义（前缀/精确/包裹）不适用 AC。
- **性能基准契约**：0.8.5 起对比目标为“0.8.5 vs 0.8.4”单轨；新增指标 `query_keyset_page` / `query_labels_multi` / `query_and_syntax` / `query_and_keyword` / `query_label_json` / `query_text_fts`；标签与文本实现评估结论见 `benchmarks/label-index-evaluation.md`。

## 0.8.6 阶段一契约（已收口）

- **增量契约**：`core/delta.rs` 定义 `DeltaKind` / `DeltaRecord` / `DeltaSource`（begin / next / commit）；USN 实现 `infra/usn_delta.rs`，重命名按“旧路径删除 + 新路径创建”展开（与 0.8.4 收敛语义一致），未来 0.8.8 配对迁移可直接替换映射。
- **USN 状态**：`IndexStore` 提供 `get_last_usn` / `set_last_usn` 默认无操作，SQLite 实现持久化到 `usn_state`（schema v5，按卷一行）；启动补账线程（`startup.rs`）无基线时记录当前 USN，有基线时执行 `(last, current]` 增量，失败只记录不阻塞。
- **MFT 枚举器**：`infra/mft.rs` 实现 `FileEnumerator` 语义的全量扫描（FILE 记录解析 + 主名策略 + 路径重建），`ROOTUP_MFT_SCAN=1` 且管理员/NTFS 才启用，失败回退 walkdir（注：当时默认实现为 walkdir；0.8.6 扫描优化将原生枚举转正为默认后，日志与回退目标改为「默认枚举器」）；扫描器日志统一 `scan: 快速扫描不可用 ...`。
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
