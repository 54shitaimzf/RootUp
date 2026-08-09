# MFT/walkdir crossover experiment

- Time: 2026-08-09 18:46:54
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Admin: True
- Corpus: generated

| size | walkdir p50 (ms) | MFT p50 (ms) | count match | errors | winner |
| --- | --- | --- | --- | --- | --- |
| 1000 | 138 | 7894 | True | 0/0 | walkdir |
| 10000 | 1026 | 5977 | True | 0/0 | walkdir |
| 50000 | 9104 | 8216 | True | 0/0 | MFT |

## Threshold and decision
- Crossover observed between 10k and 50k: MFT wins at 50k (8216ms vs 9104ms), walkdir wins below (138ms vs 7894ms at 1k).
- Recommended default for 0.8.6: MFT-first for roots with estimated size >= 50k files; keep walkdir below that threshold to avoid the fixed full-volume MFT read (~2.6GB / ~2s on this host).
- Before flipping the default: run a fine-grained confirmation (20k / 30k) and a real-directory consistency check (path set + size + time), not just counts.
- Residual: 157 / 2,200,373 files (0.007%) unresolved because some directory records carry their FILE_NAME only in attribute-list extents; documented as a 0.8.6/0.8.7 limitation (attribute-list support).
- Decision rule: consistency OK and size >= threshold -> MFT first by default; otherwise keep walkdir.
