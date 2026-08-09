# Enumerator full-pipeline consistency

- Time: 2026-08-09（多次运行汇总）
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Modes: walkdir + native（MFT 三臂与读取变体见 `mft-read-variants.md`）
- Rounds: 1；严格零差异（path/size/modified）

| label | A files | B files | A-only | B-only | size diff | time diff | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000-walkdir-vs-native | 1000 | 1000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| 10000-walkdir-vs-native | 10000 | 10000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| 50000-walkdir-vs-native | 50000 | 50000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| edge-walkdir-vs-native | 8 | 8 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| real-walkdir-vs-native | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| real-walkdir-vs-mft | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| real-native-vs-mft | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |

- 耗时（ms）：walkdir vs native 1k 83/22、10k 619/103、50k 5363/684、edge 6/14、real 10655/2457。
- MFT 读取变体对比与结论：`benchmarks/mft-read-variants.md`（parallel 已落地默认）。
