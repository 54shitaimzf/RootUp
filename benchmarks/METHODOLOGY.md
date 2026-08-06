# Benchmark 测量协议（本地统一环境）

## 总则

- 基准**仅本地运行**（`scripts/bench-all.ps1`），不在云端执行；跨版本对比必须在同一台机器、相近负载下进行。
- 每次结果记录扩展 host 指纹（OS / CPU / rustc / node / npm / RAM / commit），换机后结果标记“环境变化不可直接对比”。
- 渲染器只对同一指纹（os+cpu+rustc+ram_gb）的版本计算 delta 与 15% 警示；跨指纹、缺指纹与 legacy v1 一律展示为不可比，不产生误导性对比。
- 比较口径以 p50 为主，p90/p99 为辅；劣化 ≥15%（p50）在报告中标红警示，不阻断。

## 执行顺序

1. 构建 release（`npm run tauri build -- --no-bundle`）。
2. 确定性自检：`benchmark.ps1 -DeterminismCheck`（同 seed 生成两次 200 文件夹具，文件名+大小清单哈希必须一致）。
3. 引擎基准：`cargo bench --features bench`（释放优化，warmup 2 轮不计入；磁盘扫描/归档/冷查询 3 轮、内存查询与重分类 5 轮）。
4. 重建 release（`cargo bench` 会以 bench profile 覆盖 `target/release/rootup.exe`，必须用 `npm run tauri build -- --no-bundle` 还原带前端资源的应用）。
5. 系统基准：`scripts/benchmark.ps1`（冷启动 5 轮、暖启动 1 轮、可交互耗时、空闲 60s CPU、内存序列、扫描 IO）。
6. 渲染：`scripts/render-benchmarks.ps1`（README 对比表 + p50/p90 SVG，按指纹分组）。
7. 清理：`scripts/bench-cleanup.ps1`（临时夹具、备份、DryRun/Sample 输出与测试日志）。

## 语料

- 单一规范 `benchmarks/specs/corpus.json`：确定性种子、扩展名权重、大小分布、形状（wide/deep/mixed/noise）、噪声目录、Unicode 长路径、临时/隐藏文件比例。
- 引擎与系统基准解析同一份规范，保证两端夹具一致；官方口径为“引擎 Full（10k 全形状 + 100k 混合 + 100k 内存级）+ 系统 10k”，`-Full` 只放大引擎，`-Huge` 可选把系统放大到 300k。
- 每次全量运行前强制确定性自检（200 文件 × 2），防止语料生成器在后续版本中引入非确定性。

## 时间维度

- 冷启动：空索引库首次启动，测“启动→日志”“启动→可交互”“首扫完成”。
- 暖启动：复用已建索引库再次启动，测同一组时间点。
- 暖重扫：同一进程第二次扫描（差集）。
- 稳态：空闲 60s 的进程 CPU%（TotalProcessorTime 差分）与内存稳定值。
- 内存序列：扫描期间每 200ms 采样 WorkingSet，汇总均值/峰值。

## 空间维度

- 索引库体积：db+wal+shm 合计与每记录字节。
- churn：增删循环后先 `wal_checkpoint(TRUNCATE)` 再量体积，VACUUM 后再 checkpoint 一次量体积，并硬断言“VACUUM 后不得大于 churn 后”。
- IO：扫描后 1s 窗口内用 `GetProcessIoCounters` 差分读/写字节/秒（不再依赖性能计数器实例查找）。
- 产物体积：前端 JS/CSS gzip、dist 目录总大小。

## 严谨性

- 确定性种子；同 seed 两次生成语料一致。
- 渲染回归：同指纹版本显示 delta，跨指纹/旧版只显示“不可比”；Sample 模式自带断言（同主机 1 条警示、跨主机 0 条）。
- 随测正确性断言：扫描计数等于语料数、查询返回总数与预期一致（防“变快但算错”）。
- 每指标输出 p50/p90/p99/min/max/mean/CV/samples；warmup 2 轮不计入；暖启动/暖态/产物与索引库体积为单轮确定性指标。
- 已知限制：CI/共享机器不适用；杀毒与后台负载会引入噪音，以中位数与相对对比为准；WebView“可交互”日志在部分环境缺失时按规则缺省（不记 0）；DryRun 自校验要求 interactive、IO 六项键与扩展 host 指纹齐备，缺失即失败。

## 展示与追溯

- 每次版本基线以 JSON 入库并随版本提交，只追加不覆盖；渲染产物（README 对比表与 SVG 趋势图）同步入库。
- 仓库根 README 提供“性能基准”区块，链接到 `benchmarks/README.md` 并给出当前版本关键指标摘要。
- 发布验收后向用户汇报启动、交互、扫描、内存、索引体积与产物体积摘要，并附对比表/图表位置。

## 清理

- `bench-cleanup.ps1` 清理本机临时夹具、备份、DryRun/Sample 输出与测试日志；不触碰构建缓存与用户正式数据。
