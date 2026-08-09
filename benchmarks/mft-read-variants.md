# MFT read variants comparison (0.8.6 A/C/D)

- Time: 2026-08-09 23:41–23:51（管理员全量运行）
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- 口径：每变体跑三臂全链路（walkdir/native/MFT）严格零差异对比（path/size/modified）；`mftfile` 行已按日志修正为 FALLBACK。

| variant | corpus | walkdir ms | native ms | mft ms | mft read ms | walk-native | walk-mft | native-mft |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sequential | synth-50000 | 6,954 | 683 | 4,413 | 3,402 | PASS | PASS | PASS |
| sequential | edge | 6 | 5 | 3,850 | 3,279 | PASS | PASS | PASS |
| sequential | real | 7,436 | 2,100 | 4,849 | 3,253 | PASS | PASS | PASS |
| parallel | synth-50000 | 5,250 | 597 | 3,524 | 2,349 | PASS | PASS | PASS |
| parallel | edge | 6 | 4 | 2,791 | 2,308 | PASS | PASS | PASS |
| parallel | real | 7,736 | 2,056 | 4,075 | 2,520 | PASS | PASS | PASS |
| mftfile | synth-50000 | 5,948 | 938 | 731 | - | PASS | FALLBACK | FALLBACK |
| mftfile | edge | 9 | 4 | 10 | - | PASS | FALLBACK | FALLBACK |
| mftfile | real | 8,655 | 2,054 | 1,658 | - | PASS | FALLBACK | FALLBACK |
| nobuffer | synth-50000 | 6,334 | 797 | 4,756 | 3,643 | PASS | PASS | PASS |
| nobuffer | edge | 7 | 5 | 3,965 | 3,328 | PASS | PASS | PASS |
| nobuffer | real | 7,652 | 2,103 | 5,044 | 3,317 | PASS | PASS | PASS |

## 结论

- **parallel（A）采纳为默认**：read_ms 2,308–2,520ms，比 sequential（3,253–3,402ms）快约 26%–28%，三语料严格零差异 PASS。`ROOTUP_MFT_READ=sequential` 保留为诊断回退；`ROOTUP_MFT_PARALLEL` 控制线程数（默认 4）。
- **mftfile（C）本机不可行**：`\\.\C:\$MFT` 打开被拒，扫描器自动回退原生（10ms 级耗时、无 `read_ms` 日志、无 `MFT enumerator used`），表格行已修正为 FALLBACK——原“PASS”为原生 vs 原生假通过。若未来启用 SeBackupPrivilege 可再评估，代码已移除。
- **nobuffer（D）无收益**：read_ms 3,317–3,643ms，与 sequential 相当或更慢，未达采纳门槛；代码已移除。
- 一致性：parallel 三语料（合成 50k / 边界 / 真实 71,923）的 walk-native、walk-mft、native-mft 全部严格零差异，MFT 臂确认真实启用。
