# 原生枚举器边界与安全审查（对照 walkdir 2.5.0）

- 日期：2026-08-09；对象：`infra/enumerator.rs::Win32Enumerator`（`FindFirstFileW/FindNextFileW`，bench/test 门控）。
- 方法：阅读 walkdir `lib.rs` / `dent.rs` 的 Windows 实现，逐条对照；以单元测试、junction 实测、超长路径实测、合成语料与真实 Desktop 137,988 文件交叉验证。

## walkdir 在 Windows 上的关键行为（源码结论）

- `DirEntry::from_entry` 对每个条目调用一次 `ent.metadata()`（打开文件句柄），我们上层又调用一次 `std::fs::metadata` —— 每条文件两次系统调用；原生枚举直接取 `WIN32_FIND_DATA`，零额外调用，这是 5.8x 差距的来源。
- 单条目出错：`read_dir` 迭代器 yield `Err` 并**继续枚举**，不中断整个目录。
- `follow_links(false)` 下 `is_normal_dir = !is_symlink && is_dir`；Windows 上 `FileType::is_symlink` 等价于重解析点标志，**junction 也按符号链接处理**，不递归。
- 长路径：std/walkdir 实测可枚举超过 MAX_PATH 的路径（深层目录 + 文件发现成功）。
- 循环检测仅在 `follow_links(true)` 时启用；不跟随模式下无目录硬链接，理论上无环。
- 默认不排序、不限文件系统、不限深度；`max_open` 控制同时打开的目录句柄数。

## 原生实现处理矩阵

| 边界 | walkdir | 原生（加固后） | 结论 |
| --- | --- | --- | --- |
| 单条目错误 | 记错并继续 | 记错并继续，连续 64 次错误才放弃该目录 | 已对齐 |
| 重解析点 / junction | 按符号链接跳过 | 跳过（实测一致） | 一致 |
| 超长路径（>MAX_PATH） | 支持 | 新增 `\\?\` / `\\?\UNC\` 前缀（实测一致） | 已补齐 |
| 空目录 | 无条目 | `ERROR_FILE_NOT_FOUND` 视为空 | 一致 |
| 根不存在 / 权限拒绝 | yield 错误 | 记 errors 并继续 | 一致 |
| Unicode / 非法代理项 | 有损转换 | `from_utf16_lossy` | 一致 |
| 隐藏 / 系统 / 点文件 | 包含（交给忽略规则） | 包含（交给忽略规则） | 一致 |
| 深目录 | 迭代式遍历 | 显式栈迭代，无递归爆栈风险 | 原生更稳 |
| 句柄管理 | 受限同时打开数 | 单句柄 + `Drop` guard，用完即关 | 原生更简单 |
| 并发删除 | 元数据读取可能报错 | 使用枚举快照数据直接产出 | 可接受差异，见遗留项 |

## 测试与实测

- 单元：临时树（忽略规则 / skip_roots / 空目录 / Unicode / emoji / 点文件 / 多扩展名）、junction 对照、>260 字符深层路径对照，全部与 walkdir 路径集合、计数、错误数、大小一致。
- 合成 20k：95–125x；真实 Desktop 137,988 文件：21.4s → 3.7s（5.77x），两侧计数全等（137,988 = 137,988，10 忽略，0 错误）。

## 遗留与风险

- 并发删除/重命名：原生直接使用 `WIN32_FIND_DATA` 快照（文件在枚举后被删仍会产出），walkdir 可能对同一时刻的条目报错；差异只出现在扫描期间的极端并发，且不增加系统调用，记为有意取舍。
- `\\?\` 前缀要求路径不含 `.` / `..` 组件；应用路径已统一规范化，且仅用于搜索模式，产出路径不带前缀。
- `FindNextFileW` 中途错误的确定性单测无法稳定构造，靠代码审查 + 连续错误上限保护。
- 转正回归已完成：`enum-compare.ps1` 合成 1k/10k/50k + 真实 Desktop 71,923 全链路 DB 零差异；发布门禁仍按标准执行（smoke / db-audit / agent / pre-release）。

## 结论

原生枚举器经加固后与 walkdir 在已知边界上行为一致（长路径、junction、错误续枚举、空目录、Unicode），并在句柄与深目录处理上更简单稳健；性能优势保留（真实目录 5.77x，全链路 4.3x）。**已转正为 0.8.6 默认扫描枚举器**，`ROOTUP_ENUM=walkdir` 作为诊断回退；转正前全链路回归（合成 1k/10k/50k + 真实 Desktop）DB 集合全等 PASS。
