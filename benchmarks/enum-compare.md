# Enumerator full-pipeline consistency

- Time: 2026-08-09 23:27:03
- Host: Microsoft Windows NT 10.0.26200.0
- Modes: walkdir + native + mft
- Rounds: 1

| label | A files | B files | A-only | B-only | size diff | time diff | ratio | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| real-walkdir-vs-native | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| real-walkdir-vs-mft | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
| real-native-vs-mft | 71923 | 71923 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
