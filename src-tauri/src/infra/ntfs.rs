//! NTFS 卷能力探测 + USN 变更日志记录解析 + 路径重建（0.8.5 地基，0.8.6 阶段一供增量复用）：
//! 卷能力探测 + USN 变更日志记录解析 + 路径重建。
//!
//! 正确性约束：
//! - USN 记录不含文件大小，增量路径对每个变更文件补一次元数据读取；
//! - 日志被裁剪（FirstUsn > 0）时无法保证全量，增量路径拒绝；
//! - 权限不足 / 非 NTFS / 网络盘由 probe 判负，一律回退；
//! - 全量基线由 infra::mft（MFT）或 walkdir 承担，本模块只负责增量数据源。

use std::collections::HashMap;
use std::path::Path;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, ERROR_HANDLE_EOF, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetVolumeInformationW, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Ioctl::{
    FSCTL_QUERY_USN_JOURNAL, FSCTL_READ_USN_JOURNAL, READ_USN_JOURNAL_DATA_V0,
};
use windows::Win32::System::IO::DeviceIoControl;

/// 卷能力探测结果。
#[derive(Debug, Clone)]
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3（USN 补账）消费
pub struct VolumeCapabilities {
    pub fs_name: String,
    pub usn_available: bool,
    pub reason: String,
}

/// 从任意路径推导卷根（如 `C:\foo` → `C:`），失败返回空。
pub fn drive_root_of(path: &str) -> Option<String> {
    let p = Path::new(path);
    let root = p.components().next()?;
    let root_str = root.as_os_str().to_string_lossy();
    let drive = root_str.strip_suffix('\\').unwrap_or(&root_str);
    if drive.len() == 2 && drive.as_bytes()[1] == b':' {
        Some(drive.to_string())
    } else {
        None
    }
}

/// 探测卷文件系统与 USN 日志可用性；任何失败均判“不可用”并给出原因。
pub fn probe_volume(root: &str) -> VolumeCapabilities {
    let Some(drive) = drive_root_of(root) else {
        return VolumeCapabilities {
            fs_name: String::new(),
            usn_available: false,
            reason: format!("无法推导卷根: {root}"),
        };
    };
    let volume_path = format!("\\\\.\\{drive}");
    let wide: Vec<u16> = volume_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let root_wide: Vec<u16> = format!("{drive}\\")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            FILE_READ_ATTRIBUTES.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    };
    let handle = match handle {
        Ok(h) => h,
        Err(e) => {
            return VolumeCapabilities {
                fs_name: String::new(),
                usn_available: false,
                reason: format!("打开卷 {volume_path} 失败（可能权限不足）: {e}"),
            };
        }
    };
    let _guard = VolumeHandle(handle);

    let mut fs_name = [0u16; 64];
    let mut fs_flags = 0u32;
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(root_wide.as_ptr()),
            None,
            None,
            None,
            Some(&mut fs_flags),
            Some(&mut fs_name[..]),
        )
    };
    if ok.is_err() {
        return VolumeCapabilities {
            fs_name: String::new(),
            usn_available: false,
            reason: "读取卷信息失败".into(),
        };
    }
    let fs_name = String::from_utf16_lossy(&fs_name);
    let fs_name = fs_name.trim_end_matches('\0').to_string();

    // 查询 USN 日志（需要管理卷权限；失败按不可用处理）
    let mut query_out = [0u8; 32];
    let mut bytes_returned = 0u32;
    let io_ok = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_QUERY_USN_JOURNAL,
            None,
            0,
            Some(query_out.as_mut_ptr().cast()),
            query_out.len() as u32,
            Some(&mut bytes_returned),
            None,
        )
    };
    let usn_available = match io_ok {
        Ok(()) if bytes_returned >= 16 => {
            let first_usn = u64::from_le_bytes(query_out[8..16].try_into().unwrap());
            if first_usn > 0 {
                return VolumeCapabilities {
                    fs_name,
                    usn_available: false,
                    reason: format!(
                        "USN 日志已裁剪（FirstUsn={first_usn}），无法全量重建，回退 walkdir"
                    ),
                };
            }
            true
        }
        Ok(()) => false,
        Err(e) => {
            return VolumeCapabilities {
                fs_name,
                usn_available: false,
                reason: format!("查询 USN 日志失败（可能权限不足）: {e}"),
            };
        }
    };
    VolumeCapabilities {
        fs_name,
        usn_available,
        reason: "ok".into(),
    }
}

/// 一条解析后的 USN 记录（V2/V3 通用字段）。
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub struct UsnRecord {
    pub file_ref: u64,
    pub parent_ref: u64,
    pub usn: u64,
    pub reason: u32,
    pub modified_ms: i64,
    pub name: String,
}

#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub const USN_REASON_FILE_DELETE: u32 = 0x0000_0002;
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub const USN_REASON_RENAME_OLD_NAME: u32 = 0x0000_0010;

/// 从 DeviceIoControl 返回的缓冲区解析 USN_RECORD_V2 序列（纯函数，可单测）。
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub fn parse_usn_records(buf: &[u8]) -> Vec<UsnRecord> {
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset + 60 <= buf.len() {
        let record_len = u32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap()) as usize;
        let major = u16::from_le_bytes(buf[offset + 4..offset + 6].try_into().unwrap());
        if !(major == 2 || major == 3) || record_len < 60 || offset + record_len > buf.len() {
            break;
        }
        let file_ref = u64::from_le_bytes(buf[offset + 8..offset + 16].try_into().unwrap());
        let parent_ref = u64::from_le_bytes(buf[offset + 16..offset + 24].try_into().unwrap());
        let usn = u64::from_le_bytes(buf[offset + 24..offset + 32].try_into().unwrap());
        let ft = u64::from_le_bytes(buf[offset + 32..offset + 40].try_into().unwrap());
        let reason = u32::from_le_bytes(buf[offset + 40..offset + 44].try_into().unwrap());
        let name_len =
            u16::from_le_bytes(buf[offset + 56..offset + 58].try_into().unwrap()) as usize;
        let name_offset =
            u16::from_le_bytes(buf[offset + 58..offset + 60].try_into().unwrap()) as usize;
        let name_start = offset + name_offset;
        if name_len == 0 || !name_len.is_multiple_of(2) || name_start + name_len > buf.len() {
            break;
        }
        let mut name_units = Vec::with_capacity(name_len / 2);
        for chunk in buf[name_start..name_start + name_len].chunks_exact(2) {
            name_units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        // FILETIME（1601 起 100ns）→ Unix 毫秒
        let modified_ms = (ft / 10_000) as i64 - 11_644_473_600_000i64;
        out.push(UsnRecord {
            file_ref,
            parent_ref,
            usn,
            reason,
            modified_ms,
            name: String::from_utf16_lossy(&name_units),
        });
        offset += record_len;
    }
    out
}

/// 由 USN 记录重建 文件引用号 → 完整路径 的映射（纯函数，可单测）。
/// 跳过已删除/旧名记录；父链缺失或成环时该条目不产出（保持“宁可少扫，不可错扫”）。
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub fn resolve_paths(records: &[UsnRecord], drive: &str) -> HashMap<u64, String> {
    resolve_paths_inner(records, drive, true)
}

/// 增量路径重建：包含已删除/旧名记录（补账需要旧路径）。
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub fn resolve_delta_paths(records: &[UsnRecord], drive: &str) -> HashMap<u64, String> {
    resolve_paths_inner(records, drive, false)
}

fn resolve_paths_inner(
    records: &[UsnRecord],
    drive: &str,
    skip_deleted: bool,
) -> HashMap<u64, String> {
    let mut nodes: HashMap<u64, (String, u64)> = HashMap::new();
    for record in records {
        if skip_deleted
            && record.reason & (USN_REASON_FILE_DELETE | USN_REASON_RENAME_OLD_NAME) != 0
        {
            continue;
        }
        nodes.insert(record.file_ref, (record.name.clone(), record.parent_ref));
    }
    let mut cache: HashMap<u64, Option<String>> = HashMap::new();
    let mut resolved: HashMap<u64, String> = HashMap::new();
    for &file_ref in nodes.keys() {
        let mut segments = Vec::new();
        let mut current = file_ref;
        let mut seen = std::collections::HashSet::new();
        let mut cached_prefix: Option<String> = None;
        let mut ok = true;
        for _ in 0..128 {
            if let Some(Some(prefix)) = cache.get(&current) {
                cached_prefix = Some(prefix.clone());
                break;
            }
            if cache.get(&current) == Some(&None) {
                ok = false;
                break;
            }
            let Some((name, parent)) = nodes.get(&current) else {
                ok = false;
                break;
            };
            if !seen.insert(current) {
                ok = false;
                break;
            }
            segments.push(name.clone());
            current = *parent;
            if current == 0 {
                break;
            }
        }
        if !ok {
            cache.insert(file_ref, None);
            continue;
        }
        let full = match cached_prefix {
            Some(prefix) if segments.is_empty() => prefix,
            Some(prefix) => {
                segments.reverse();
                format!("{prefix}/{}", segments.join("/"))
            }
            None => {
                if segments.is_empty() {
                    cache.insert(file_ref, None);
                    continue;
                }
                segments.reverse();
                format!("{drive}/{}", segments.join("/"))
            }
        };
        resolved.insert(file_ref, full.clone());
        cache.insert(file_ref, Some(full));
    }
    resolved
}

/// 查询卷当前 USN（NextUsn）；失败返回 Err（权限/非 NTFS）。
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub fn current_usn(drive: &str) -> Result<u64, String> {
    let handle = open_volume(drive)?;
    let _guard = VolumeHandle(handle);
    let mut out = [0u8; 64];
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            FSCTL_QUERY_USN_JOURNAL,
            None,
            0,
            Some(out.as_mut_ptr().cast()),
            out.len() as u32,
            Some(&mut returned),
            None,
        )
    }
    .map_err(|e| format!("查询 USN 日志失败: {e}"))?;
    if returned < 24 {
        return Err("USN 查询结果不完整".into());
    }
    Ok(u64::from_le_bytes(out[16..24].try_into().unwrap()))
}

/// 读取 (start_usn, current] 的 USN 增量记录；日志被裁剪或权限不足返回 Err。
#[cfg_attr(not(test), allow(dead_code))] // 0.8.6 阶段一 M3 消费
pub fn read_usn_delta(drive: &str, start_usn: u64) -> Result<(Vec<UsnRecord>, u64), String> {
    let handle = open_volume(drive)?;
    let _guard = VolumeHandle(handle);
    let mut query = [0u8; 64];
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            FSCTL_QUERY_USN_JOURNAL,
            None,
            0,
            Some(query.as_mut_ptr().cast()),
            query.len() as u32,
            Some(&mut returned),
            None,
        )
    }
    .map_err(|e| format!("查询 USN 日志失败: {e}"))?;
    if returned < 24 {
        return Err("USN 查询结果不完整".into());
    }
    let first_usn = u64::from_le_bytes(query[8..16].try_into().unwrap());
    let current = u64::from_le_bytes(query[16..24].try_into().unwrap());
    if first_usn > start_usn {
        return Err(format!(
            "USN 日志已裁剪（first={first_usn} > last={start_usn}），无法补账"
        ));
    }
    if start_usn >= current {
        return Ok((Vec::new(), current));
    }

    let mut records = Vec::new();
    let mut input = READ_USN_JOURNAL_DATA_V0 {
        StartUsn: start_usn as i64,
        ReasonMask: 0xFFFF_FFFF,
        ReturnOnlyOnClose: 0,
        Timeout: 0,
        BytesToWaitFor: 0,
        UsnJournalID: 0,
    };
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let mut bytes_returned = 0u32;
        let io = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_READ_USN_JOURNAL,
                Some((&mut input as *mut READ_USN_JOURNAL_DATA_V0).cast()),
                std::mem::size_of::<READ_USN_JOURNAL_DATA_V0>() as u32,
                Some(buf.as_mut_ptr().cast()),
                buf.len() as u32,
                Some(&mut bytes_returned),
                None,
            )
        };
        match io {
            Ok(()) => {
                let parsed = parse_usn_records(&buf[..bytes_returned as usize]);
                let before = records.len();
                records.extend(parsed);
                let last = records.last().map(|r| r.usn).unwrap_or(0);
                input.StartUsn = last as i64;
                if records.len() == before || last >= current {
                    break;
                }
            }
            Err(e) if e.code() == ERROR_HANDLE_EOF.into() => break,
            Err(e) => return Err(format!("读取 USN 日志失败: {e}")),
        }
        if records.len() > 1_000_000 {
            return Err("USN 增量记录数异常，放弃补账".into());
        }
    }
    Ok((records, current))
}

fn open_volume(drive: &str) -> Result<HANDLE, String> {
    let volume_path = format!("\\\\.\\{drive}");
    let wide: Vec<u16> = volume_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            FILE_READ_ATTRIBUTES.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|e| format!("打开卷 {volume_path} 失败（可能权限不足）: {e}"))
}

struct VolumeHandle(HANDLE);
impl Drop for VolumeHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usn_record(file_ref: u64, parent_ref: u64, reason: u32, name: &str) -> UsnRecord {
        UsnRecord {
            file_ref,
            parent_ref,
            usn: file_ref,
            reason,
            modified_ms: 1_700_000_000_000,
            name: name.to_string(),
        }
    }

    #[test]
    fn drive_root_of_extracts_drive() {
        assert_eq!(drive_root_of("C:/Users/me/docs").as_deref(), Some("C:"));
        assert_eq!(drive_root_of("D:\\x").as_deref(), Some("D:"));
        assert_eq!(drive_root_of("relative/path"), None);
        assert_eq!(drive_root_of(""), None);
    }

    #[test]
    fn parse_usn_records_reads_v2_layout() {
        // 手工构造两条 USN_RECORD_V2（RecordLength=60+name bytes）
        fn build(file_ref: u64, parent: u64, reason: u32, name: &str) -> Vec<u8> {
            let name_units: Vec<u16> = name.encode_utf16().collect();
            let record_len = 60 + name_units.len() * 2;
            let mut buf = vec![0u8; record_len];
            buf[0..4].copy_from_slice(&(record_len as u32).to_le_bytes());
            buf[4..6].copy_from_slice(&2u16.to_le_bytes()); // major V2
            buf[8..16].copy_from_slice(&file_ref.to_le_bytes());
            buf[16..24].copy_from_slice(&parent.to_le_bytes());
            buf[24..32].copy_from_slice(&42u64.to_le_bytes()); // usn
            buf[40..44].copy_from_slice(&reason.to_le_bytes());
            buf[56..58].copy_from_slice(&((name_units.len() * 2) as u16).to_le_bytes());
            buf[58..60].copy_from_slice(&60u16.to_le_bytes());
            for (i, unit) in name_units.iter().enumerate() {
                buf[60 + i * 2..62 + i * 2].copy_from_slice(&unit.to_le_bytes());
            }
            buf
        }
        let mut blob = build(10, 5, 0x100, "report.pdf");
        blob.extend(build(5, 0, 0x100, "docs"));
        let records = parse_usn_records(&blob);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].name, "report.pdf");
        assert_eq!(records[0].file_ref, 10);
        assert_eq!(records[0].parent_ref, 5);
        assert_eq!(records[1].name, "docs");
        assert_eq!(records[1].parent_ref, 0);
    }

    #[test]
    fn resolve_paths_builds_full_paths_and_skips_deleted() {
        let records = vec![
            usn_record(1, 2, 0x100, "a.txt"),
            usn_record(2, 3, 0x100, "dir"),
            usn_record(3, 0, 0x100, "root"),
            usn_record(4, 1, USN_REASON_FILE_DELETE, "gone.txt"),
            usn_record(5, 99, 0x100, "orphan.txt"),
        ];
        let paths = resolve_paths(&records, "C:");
        assert_eq!(paths.get(&1).map(String::as_str), Some("C:/root/dir/a.txt"));
        assert_eq!(paths.get(&2).map(String::as_str), Some("C:/root/dir"));
        assert_eq!(paths.get(&3).map(String::as_str), Some("C:/root"));
        assert!(!paths.contains_key(&4), "已删除记录不应产出路径");
        assert!(!paths.contains_key(&5), "父链缺失不应产出路径");
    }

    #[test]
    fn resolve_paths_guards_cycles() {
        let records = vec![usn_record(1, 2, 0x100, "a"), usn_record(2, 1, 0x100, "b")];
        let paths = resolve_paths(&records, "C:");
        assert!(paths.is_empty());
    }
}
