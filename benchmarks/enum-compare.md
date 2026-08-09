# Enumerator full-pipeline consistency

- Time: 2026-08-09 23:39:49
- Host: Microsoft Windows NT 10.0.26200.0
- Modes: walkdir + native
- MftRead: <sequential>
- Rounds: 1

| label | A files | B files | A-only | B-only | size diff | time diff | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
- elapsed_ms: edge walkdir = 9
- elapsed_ms: edge native = 4
| edge-walkdir-vs-native | 8 | 8 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
