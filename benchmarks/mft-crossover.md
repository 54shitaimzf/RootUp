# MFT/walkdir crossover experiment

- Time: 2026-08-09 21:35:34
- Host: Microsoft Windows NT 10.0.26200.0 (UBR 8875)
- Admin: True
- Corpus: generated
- Sizes param: <>
- Sizes used: 1000,10000,50000

| size | walkdir p50 (ms) | MFT p50 (ms) | count match | errors | winner |
| --- | --- | --- | --- | --- | --- |
| 1000 | 140 | 5095 | True | 0/0 | walkdir |
| 10000 | 1170 | 4402 | True | 0/0 | walkdir |
| 50000 | 8828 | 5977 | True | 0/0 | MFT |

## Threshold and decision
- Suggested threshold: first size in the table where MFT wins; if even 50k does not win, mark MFT not recommended for this corpus
- Decision rule: consistency OK and size >= threshold -> MFT first by default; otherwise keep walkdir.

## 0.8.6 读取优化验证（2026-08-09）

- 本表为优化后运行：MFT 卷句柄加 `FILE_FLAG_SEQUENTIAL_SCAN`、读块 8MiB→32MiB；DB 子批 500→1000、FTS 表存在性单次检查；walkdir 跳过集改为枚举开始时快照。
- 阶段对比（同机 25H2 UBR 8875）：
  - 1k：MFT 总 5358→5095ms（read 3828→3558ms，-7.1%）
  - 10k：MFT 总 4806→4402ms（read 3463→3355ms，-3.1%）
  - 50k：MFT 总 6291→5977ms（-5.0%）
- walkdir 侧在噪声范围内（1k 169→140ms、10k 1079→1170ms、50k 9284→8828ms）。
- 一致性：三档 count 全等、errors=0；真实目录 71,923 文件 size diff=0（见 mft-real-compare.md）。
- 结论：读取微优化带来约 3%–7% 可测量收益；MFT 固定全卷读取成本仍在，50k 档仍为交叉点，默认策略保持 walkdir。
