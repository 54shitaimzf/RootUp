# Native vs walkdir full-pipeline comparison

- Time: 2026-08-09 22:56:36
- Host: Microsoft Windows NT 10.0.26200.0
- Root: generated + C:\Users\Administrator\Desktop
- Rounds: 1

| label | walk files | native files | walk-only | native-only | size diff | time diff | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 1000 | 1000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| 10000 | 10000 | 10000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| 50000 | 50000 | 50000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| real | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |

- 耗时：1k walkdir 159ms / native 24ms；10k 833/116ms；50k 8676/687ms；real 10655/2457ms。
