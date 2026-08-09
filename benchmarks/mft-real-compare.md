# MFT real-dir consistency validation

- Time: 2026-08-09 21:44:31
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Root: C:\Users\Administrator\Desktop
- Rounds: 1

| round | walk files | mft files | walk-only | mft-only | size diff | time diff | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| round 1 | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |

## 结论（2026-08-09 21:44）

- attribute-list 大小兜底确认：`size diff` 5 → 0；71,923 文件数量、大小、时间全等，PASS。
