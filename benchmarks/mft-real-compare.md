# MFT real-dir consistency validation

- Time: 2026-08-09 20:52:51
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Root: C:\Users\Administrator\Desktop
- Rounds: 3

| round | walk files | mft files | walk-only | mft-only | size diff | time diff | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| round 1 | 71923 | 71923 | 0 | 0 | 5 | 0 | 0.0070% | PASS |
| round 2 | 71923 | 71923 | 0 | 0 | 5 | 0 | 0.0070% | PASS |
| round 3 | 71923 | 71923 | 0 | 0 | 5 | 0 | 0.0070% | PASS |

## Update（2026-08-09，e365396）

上表运行于 attribute-list 大小兜底落地之前（5 个文件因 extent 未解析到 `$DATA` 而大小为 0）。`e365396` 已加入兜底：`size_known=false` 时按路径补查元数据。需管理员重跑 `mft-real-compare.ps1 -Root "C:\Users\Administrator\Desktop" -Rounds 1` 确认 `size diff=0` 后更新本报告。
