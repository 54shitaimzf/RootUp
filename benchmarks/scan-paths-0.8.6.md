# 0.8.6 scan-path comparison (walkdir / native / MFT / optimizer)

- Time: 2026-08-10 02:12:24
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Admin: True
- Rounds: 3
- Corpus: generated, sizes 1000,10000,20000,30000,50000
- Strict DB compare: True

| size | walkdir p50 (ms) | native p50 (ms) | MFT p50 (ms) | optimizer p50 (ms) | consistency |
| --- | --- | --- | --- | --- | --- |
| 1000 | 129 | 24 | 3230 | 29 | True |
| 10000 | 956 | 106 | 3111 | 102 | True |
| 20000 | 1691 | 188 | 3009 | 182 | True |
| 30000 | 3920 | 430 | 3353 | 418 | True |
| 50000 | 6719 | 685 | 3761 | 765 | True |

## Optimizer decisions (fresh index, model defaults)
- 1000 : root_count=0 crossover=Some(312500.0) use_mft=False force_mft=False
- 10000 : root_count=0 crossover=Some(312500.0) use_mft=False force_mft=False
- 20000 : root_count=0 crossover=Some(312500.0) use_mft=False force_mft=False
- 30000 : root_count=0 crossover=Some(312500.0) use_mft=False force_mft=False
- 50000 : root_count=0 crossover=Some(312500.0) use_mft=False force_mft=False

## DB set comparison (strict)
- 1000_walkdir_vs_native : | 1000:walkdir->native | 1000 | 1000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 1000_native_vs_mft : | 1000:native->mft | 1000 | 1000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 1000_mft_vs_optimizer : | 1000:mft->optimizer | 1000 | 1000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 10000_walkdir_vs_native : | 10000:walkdir->native | 10000 | 10000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 10000_native_vs_mft : | 10000:native->mft | 10000 | 10000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 10000_mft_vs_optimizer : | 10000:mft->optimizer | 10000 | 10000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 20000_walkdir_vs_native : | 20000:walkdir->native | 20000 | 20000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 20000_native_vs_mft : | 20000:native->mft | 20000 | 20000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 20000_mft_vs_optimizer : | 20000:mft->optimizer | 20000 | 20000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 30000_walkdir_vs_native : | 30000:walkdir->native | 30000 | 30000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 30000_native_vs_mft : | 30000:native->mft | 30000 | 30000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 30000_mft_vs_optimizer : | 30000:mft->optimizer | 30000 | 30000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 50000_walkdir_vs_native : | 50000:walkdir->native | 50000 | 50000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 50000_native_vs_mft : | 50000:native->mft | 50000 | 50000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
- 50000_mft_vs_optimizer : | 50000:mft->optimizer | 50000 | 50000 | 0 | 0 | 0 | 0 | 0.0000% | PASS |
