# jwalk 并行遍历评估结论（0.8.4）

## 背景

0.8.4 路线图要求评估 jwalk（仅目录多 / 目录深的场景可能收益）。
`FileEnumerator` 契约已在本版本落地（`core/scan.rs`），walkdir 为默认实现
（`infra/enumerator.rs::WalkDirEnumerator`），MFT/USN 或 jwalk 后续都可作为新实现插入。

## 决策

**0.8.4 不引入 jwalk 依赖，评估推迟到 0.8.5 与 MFT/USN 快速扫描一起进行。**

理由：

- 0.8.4 定位为“存储与扫描地基”，差集已落库（`ScanDiffStore`），当前扫描瓶颈不再是 walkdir 本身；
- jwalk 属于第三方依赖，收益集中在深/宽目录场景，需要真实语料基准验证后才值得引入；
- 引入新依赖前需要先跑通等价测试与性能对比，这更适合与 0.8.5 的 NTFS 快速扫描一起做统一枚举器评估。

## 后续触发条件（0.8.5）

- 建立 deep/wide 语料基准（可复用 `benchmarks/specs/corpus.json`）；
- 用 feature 开关实现 `JwalkEnumerator` 原型，与 `WalkDirEnumerator` 对比耗时与内存；
- 仅在“行为等价 + 显著收益（建议 ≥30%）”时引入，否则维持 walkdir 默认实现。

## 验收口径

- `FileEnumerator` 保持为唯一枚举入口，任何新实现不得改变忽略规则、跳过集与符号链接语义；
- 等价测试与扫描差集测试全绿后才能评估性能。
