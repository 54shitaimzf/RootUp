# Benchmark 测量协议（本地统一环境）

## 总则

- 基准**仅本地运行**（`scripts/bench-all.ps1`），不在云端执行；跨版本对比必须在同一台机器、相近负载下进行。
- 每次结果记录 host 指纹（OS / CPU / rustc），换机后结果标记“环境变化不可直接对比”。
- 比较口径以 p50 为主，p90/p99 为辅；劣化 ≥15%（p50）在报告中标红警示，不阻断。

## 执行顺序

1. 构建 release（`npm run tauri build -- --no-bundle`）。
2. 引擎基准：`cargo bench --features bench`（释放优化，warmup 2 轮 + 5 轮采样）。
3. 系统基准：`scripts/benchmark.ps1`（冷启动 5 轮、暖启动 1 轮、空闲 60s CPU、内存序列）。
4. 渲染：`scripts/render-benchmarks.ps1`（README 对比表 + p50/p90 SVG）。
5. 清理：`scripts/bench-cleanup.ps1`（临时夹具、备份、DryRun/Sample 输出）。

## 语料

- 单一规范 `benchmarks/specs/corpus.json`：确定性种子、扩展名权重、大小分布、形状（wide/deep/mixed/noise）、噪声目录、Unicode 长路径、临时/隐藏文件比例。
- 引擎与系统基准解析同一份规范，保证两端夹具一致；文件数按规模档位（10k 默认 / 100k `-Full` / 300k `-Huge`）。

## 时间维度

- 冷启动：空索引库首次启动，测“启动→日志”“启动→可交互”“首扫完成”。
- 暖启动：复用已建索引库再次启动，测同一组时间点。
- 暖重扫：同一进程第二次扫描（差集）。
- 稳态：空闲 60s 的进程 CPU%（TotalProcessorTime 差分）与内存稳定值。
- 内存序列：扫描期间每 200ms 采样 WorkingSet，汇总均值/峰值。

## 空间维度

- 索引库体积：db+wal+shm 合计与每记录字节。
- churn：增删循环后体积、VACUUM 后体积。
- IO：扫描期间进程读/写字节/秒（Windows 性能计数器，尽力而为）。
- 产物体积：前端 JS/CSS gzip、dist 目录总大小。

## 严谨性

- 确定性种子；同 seed 两次生成语料一致。
- 随测正确性断言：扫描计数等于语料数、查询返回总数与预期一致（防“变快但算错”）。
- 每指标输出 p50/p90/p99/min/max/mean/CV/samples；warmup 2 轮不计入。
- 已知限制：CI/共享机器不适用；杀毒与后台负载会引入噪音，以中位数与相对对比为准；WebView“可交互”日志在部分环境缺失时按规则缺省（不记 0）。

## 清理

- `bench-cleanup.ps1` 清理本机临时夹具、备份、DryRun/Sample 输出与测试日志；不触碰构建缓存与用户正式数据。
