# 枚举器一致性校验矩阵（native / walkdir / MFT）

- 更新：2026-08-09（闭环）；范围：0.8.6 原生枚举器落地的一致性证据。

## 校验矩阵

| 层 | 对比 | 语料 | 断言 | 结果 | 权限 |
| --- | --- | --- | --- | --- | --- |
| 单元 | native vs walkdir | 临时树（忽略规则 / skip_roots / Unicode / emoji / 空目录 / 点文件 / 多扩展名） | 路径集合 / 计数 / 忽略 / 错误 / 大小 | PASS | 无 |
| 单元 | native vs walkdir | junction | 路径集合 / 计数 / 错误 | PASS | 无 |
| 单元 | native vs walkdir | >260 超长路径 | 路径集合 / 计数 / 错误 | PASS | 无 |
| 枚举器 | native vs walkdir / jwalk | deep 300 + wide 20k | 计数 / 忽略 / 错误全等 | PASS | 无 |
| 全链路 | walkdir vs native | 合成 1k / 10k / 50k | DB 集合（path/size/modified）零差异 | PASS | 无 |
| 全链路 | walkdir vs native | 真实 Desktop 71,923 | DB 集合零差异 | PASS | 无 |
| 全链路 | walkdir vs native | 边界语料（Unicode / 隐藏 / 点文件 / 空目录 / junction / 超长路径 / 深链，8 文件） | DB 集合零差异 | PASS | 无 |
| 全链路 | walkdir vs MFT | 合成 1k / 10k / 50k | 计数 / 错误（`mft-verify.ps1`） | PASS | 管理员 |
| 全链路 | walkdir vs MFT | 真实 Desktop 71,923 | DB 集合零差异（`mft-real-compare.ps1`） | PASS | 管理员 |
| 全链路 | native vs MFT | 真实 Desktop 71,923（三臂：walkdir/native/MFT，日志确认 MFT 启用） | DB 集合零差异（`enum-compare.ps1 -Mft`） | PASS | 管理员 |

## 安全性兜底（与枚举器无关的独立防线）

- 删除风暴保护：差集缺失比例超过阈值（>25% 或 <500 条）时跳过批量删除，枚举器异常返回 0 文件不会导致索引被清空。
- 枚举错误不放大：单条目错误计数并继续；扫描器前置检查根目录存在性；MFT 失败自动回退默认枚举并记录降级原因。
- 差集双确认：`finish_scan_diff` 的候选缺失项在标记 deleted 前还会二次确认路径不存在。
- 查询绑定矩阵 / db-audit / smoke 独立于枚举器实现，发布门禁覆盖。

## 结论

常规语料与边界语料下 native↔walkdir 一致性已充分验证（单元 + 全链路 DB 零差异）；walkdir↔MFT 与 native↔MFT 均已直接验证（真实 Desktop 71,923 三臂两两对比零差异，日志确认 MFT 臂真实启用）。合成档的 native↔MFT 直接对比可选补跑（`-Mft -Sizes "1000,10000,50000"`），现有证据链（native=walkdir、walkdir=MFT、真实目录 native=MFT）已足够。
