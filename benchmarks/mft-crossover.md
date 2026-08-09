# MFT/walkdir crossover experiment

- Time: 2026-08-09 20:54:02
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Admin: True
- Corpus: generated
- Sizes param: <20000,30000>
- Sizes used: 20000,30000

| size | walkdir p50 (ms) | MFT p50 (ms) | count match | errors | winner |
| --- | --- | --- | --- | --- | --- |
| 20000 | 2701 | 5451 | True | 0/0 | walkdir |
| 30000 | 7479 | 5529 | True | 0/0 | MFT |

## Threshold and decision
- Earlier runs (same host, 2026-08-09): 1k walkdir 169ms / MFT 5358ms, 10k 1079 / 4806, 50k 9284 / 6291 -> MFT wins at 50k.
- This run: 20k walkdir 2701ms / MFT 5451ms (walkdir wins), 30k walkdir 7479ms / MFT 5529ms (MFT wins).
- The jump between 20k and 30k is on the walkdir side (+50% files but +177% time), while MFT stays ~constant (fixed full-volume read dominates). The 30k walkdir reading is likely inflated by a freshly generated corpus (cold cache / AV scan); treat the exact crossover as 20k-30k with noise, recommend a 25k confirmation before locking the threshold.
- Decision rule: consistency OK and size >= threshold -> MFT first by default; otherwise keep walkdir. Recommended default threshold for now: 30k (or 25k after confirmation).
