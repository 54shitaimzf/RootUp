# NTFS MFT/USN 快速扫描评估（0.8.5 决策记录）

> 日期：2026-08-08；依赖：官方 `windows` crate 0.62（`Win32_Foundation` / `Win32_Storage_FileSystem` / `Win32_System_Ioctl` / `Win32_Security` / `Win32_System_IO`）。

## 结论

- **本版落地**：卷能力探测（文件系统类型 + USN 日志可用性）、USN 记录解析（V2/V3）、文件引用号→完整路径重建（父链 + 环保护 + 缺失父链跳过）、硬链接按文件引用去重；快速路径以 `ROOTUP_FAST_SCAN=1` 实验性门控，默认回退 walkdir 保证行为等价。
- **不做 MFT 原始解析基线**（顺延 0.8.6）：`ntfs-core` / `usn-journal-rs` 评估后均不满足“文件大小 + 完整路径 + 活跃维护”组合（`ntfs-core` 偏底层只读解析、`usn-journal-rs` 维护度低）；自研 `FSCTL_ENUM_MFT` + 属性解析需要管理员权限且路径重建复杂度高，风险大于本版收益。
- **USN 不能替代全量基线**：USN 记录不含文件大小（本版对每个文件补元数据读取，抵消速度收益）；日志被裁剪（FirstUsn > 0）时无法保证全量，probe 直接判负回退。
- **0.8.6 路线**：MFT 基线（管理员）或“USN 增量对账 + walkdir 基线”双轨；先完成快速路径在真实 NTFS 卷的提权验收（需用户批准），再转默认。

## 降级矩阵

| 场景 | 行为 | 日志 |
| --- | --- | --- |
| 非 NTFS / 网络盘 | probe 判负 → walkdir | `scan: 快速扫描不可用 ... 回退 walkdir` |
| 权限不足（非提权） | 打开卷或查询日志失败 → walkdir | 同上（含原因） |
| USN 日志已裁剪 | FirstUsn > 0 → walkdir | 同上（含 FirstUsn） |
| 未设 ROOTUP_FAST_SCAN | 默认 → walkdir | 同上（未启用） |
| 快速路径任意失败 | Err → walkdir | 同上 |

## 单元验证

- `drive_root_of`：盘符推导。
- `parse_usn_records`：手工构造 V2 记录字节流解析（名称/引用号/父引用/USN/原因/时间）。
- `resolve_paths`：多层路径、删除记录跳过、父链缺失跳过、环保护。
- 扫描器接入后 313 项 Rust 测试全绿（默认路径不受影响）。
