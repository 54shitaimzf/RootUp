//! MFT 快速基线（原始 `$MFT` 解析，0.8.6 阶段一）。
//!
//! 结构与边界依据（仅参考、不复制代码）：
//! - Linux-ntfs 官方 NTFS on-disk 文档（FILE_RECORD / ATTR_RECORD / FILE_NAME 布局）；
//! - ntfs-3g `libntfs-3g`（layout.h / mft.c / attr.c / inode.c）的属性遍历、extent 与
//!   硬链接处理经验；The Sleuth Kit `ntfs.c` 的损坏/截断容错经验。
//!
//! 正确性约束：
//! - 全程边界检查，损坏/截断缓冲返回 Err，不 panic；
//! - 跳过 extent 记录（base record ≠ 0）、元文件区、重解析点与目录；
//! - 硬链接取“命名空间优先 + 名称确定性最小”的主名；
//! - 需要管理员（SeBackupPrivilege）；未提权/非 NTFS 一律回退 walkdir。

use crate::core::ignore::IgnoreMatcher;
use crate::core::path::normalize_path;
use crate::core::scan::{EnumerateStats, FileEntry};
use crate::infra::ntfs::{drive_root_of, probe_volume, MFT_REFERENCE_MASK};
use std::collections::HashMap;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetLongPathNameW, ReadFile, SetFilePointerEx, FILE_BEGIN,
    FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Ioctl::FSCTL_GET_NTFS_VOLUME_DATA;
use windows::Win32::System::IO::DeviceIoControl;

const FILE_RECORD_SIGNATURE: [u8; 4] = *b"FILE";
const ATTR_END: u32 = 0xFFFF_FFFF;
const ATTR_STANDARD_INFORMATION: u32 = 0x10;
const ATTR_FILE_NAME: u32 = 0x30;
const ATTR_DATA: u32 = 0x80;
const FILE_ATTR_REPARSE_POINT: u32 = 0x400;
const MFT_FIXUP_SECTOR: usize = 512;
const MFT_READ_TARGET: usize = 8 * 1024 * 1024;
const MFT_PROGRESS_INTERVAL: u64 = 256 * 1024 * 1024;
const GENERIC_READ: u32 = 0x8000_0000;
const FSCTL_ALLOW_EXTENDED_DASD_IO: u32 = 0x0009_0083;
const LONG_PATH_BUF: usize = 32 * 1024;

/// 解析后的 FILE_NAME 属性（0x30）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileNameAttr {
    pub parent_ref: u64,
    pub creation_ms: i64,
    pub modified_ms: i64,
    pub allocated_size: u64,
    pub data_size: u64,
    pub file_attributes: u32,
    pub namespace: u8,
    pub name: String,
}

/// 解析后的 MFT 文件记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MftRecord {
    pub record_number: u64,
    pub in_use: bool,
    pub is_directory: bool,
    pub is_extent: bool,
    pub base_record: u64,
    pub file_names: Vec<FileNameAttr>,
    pub si_attributes: Option<u32>,
    pub si_modified_ms: Option<i64>,
    /// 未命名 `$DATA` 的真实大小（resident 为值长度，non-resident 为 RealSize）。
    pub data_size: Option<u64>,
}

fn read_u16(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

fn read_u32(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
}

fn read_u64(buf: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
}

/// FILETIME（1601 起 100ns）→ Unix 毫秒。
fn filetime_to_ms(ft: u64) -> i64 {
    (ft / 10_000) as i64 - 11_644_473_600_000i64
}

/// 应用更新序列（USA/fixup）修复；返回修复后的记录缓冲（含校验）。
fn apply_fixups(buf: &mut [u8]) -> Result<(), String> {
    if buf.len() < 48 {
        return Err("MFT 记录过短".into());
    }
    let usa_offset = read_u16(buf, 0x04) as usize;
    let usa_count = read_u16(buf, 0x06) as usize;
    if usa_count < 2 || usa_offset + usa_count * 2 > buf.len() {
        return Err("USA 偏移越界".into());
    }
    let sector_count = usa_count - 1;
    if sector_count * MFT_FIXUP_SECTOR > buf.len() {
        return Err("USA 扇区数越界".into());
    }
    let signature = read_u16(buf, usa_offset);
    for i in 0..sector_count {
        let end = (i + 1) * MFT_FIXUP_SECTOR - 2;
        let on_disk = read_u16(buf, end);
        if on_disk != signature {
            return Err("USA 校验失败".into());
        }
        let original = read_u16(buf, usa_offset + 2 + i * 2);
        buf[end..end + 2].copy_from_slice(&original.to_le_bytes());
    }
    Ok(())
}

fn parse_file_name_value(value: &[u8]) -> Result<FileNameAttr, String> {
    if value.len() < 0x42 {
        return Err("FILE_NAME 值过短".into());
    }
    let name_len = value[0x40] as usize;
    let namespace = value[0x41];
    let name_bytes = value
        .get(0x42..0x42 + name_len * 2)
        .ok_or_else(|| "FILE_NAME 名称越界".to_string())?;
    let mut units = Vec::with_capacity(name_len);
    for chunk in name_bytes.chunks_exact(2) {
        units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
    }
    Ok(FileNameAttr {
        // FILE_NAME 的父引用是打包的 MFT 引用（记录号 + 序号），只取记录号部分。
        parent_ref: read_u64(value, 0x00) & MFT_REFERENCE_MASK,
        creation_ms: filetime_to_ms(read_u64(value, 0x08)),
        modified_ms: filetime_to_ms(read_u64(value, 0x10)),
        allocated_size: read_u64(value, 0x28),
        data_size: read_u64(value, 0x30),
        file_attributes: read_u32(value, 0x38),
        namespace,
        name: String::from_utf16_lossy(&units),
    })
}

/// 解析一条 MFT 文件记录（纯函数，可单测）。
pub fn parse_file_record(input: &[u8]) -> Result<MftRecord, String> {
    if input.len() < 48 || input[0..4] != FILE_RECORD_SIGNATURE {
        return Err("非 FILE 记录".into());
    }
    let mut buf = input.to_vec();
    apply_fixups(&mut buf)?;

    let flags = read_u16(&buf, 0x16);
    let attrs_offset = read_u16(&buf, 0x14) as usize;
    let used_size = read_u32(&buf, 0x18) as usize;
    if attrs_offset < 48 || attrs_offset >= used_size || used_size > buf.len() {
        return Err("属性区偏移越界".into());
    }

    let mut file_names = Vec::new();
    let mut si_attributes = None;
    let mut si_modified_ms = None;
    let mut data_size = None;
    let mut offset = attrs_offset;
    let mut guard = 0usize;
    while offset + 8 <= used_size && guard < 64 {
        guard += 1;
        let attr_type = read_u32(&buf, offset);
        let attr_len = read_u32(&buf, offset + 4) as usize;
        if attr_type == ATTR_END {
            break;
        }
        if attr_len < 0x18 || offset + attr_len > used_size {
            return Err("属性头越界".into());
        }
        let non_resident = buf[offset + 8] != 0;
        let unnamed = buf[offset + 9] == 0;
        if !non_resident {
            let value_len = read_u32(&buf, offset + 0x10) as usize;
            let value_off = read_u16(&buf, offset + 0x14) as usize;
            let value = buf
                .get(offset + value_off..offset + value_off + value_len)
                .ok_or_else(|| "属性值越界".to_string())?;
            match attr_type {
                ATTR_FILE_NAME => file_names.push(parse_file_name_value(value)?),
                ATTR_STANDARD_INFORMATION if value.len() >= 0x24 => {
                    si_attributes = Some(read_u32(value, 0x20));
                    si_modified_ms = Some(filetime_to_ms(read_u64(value, 0x08)));
                }
                ATTR_DATA if unnamed => data_size = Some(value_len as u64),
                _ => {}
            }
        } else if ATTR_DATA == attr_type && unnamed {
            // Non-resident $DATA 头：RealSize 位于属性起点 + 0x30。
            let real = buf.get(offset + 0x30..offset + 0x38);
            if let Some(bytes) = real {
                data_size = Some(u64::from_le_bytes(bytes.try_into().unwrap()));
            }
        }
        offset += attr_len;
    }

    Ok(MftRecord {
        record_number: read_u32(&buf, 0x2C) as u64,
        in_use: flags & 0x01 != 0,
        is_directory: flags & 0x02 != 0,
        is_extent: flags & 0x04 != 0,
        base_record: read_u64(&buf, 0x20),
        file_names,
        si_attributes,
        si_modified_ms,
        data_size,
    })
}

/// 命名空间优先级：Win32 / Win32&DOS 最高，POSIX 次之，DOS（8.3）最低。
fn namespace_priority(namespace: u8) -> u8 {
    match namespace {
        1 | 3 => 0,
        0 => 1,
        _ => 2,
    }
}

/// 每个记录选一个主 FILE_NAME（确定性）：命名空间优先级 + 名称字典序最小。
pub fn primary_file_name(record: &MftRecord) -> Option<&FileNameAttr> {
    record.file_names.iter().min_by(|a, b| {
        namespace_priority(a.namespace)
            .cmp(&namespace_priority(b.namespace))
            .then_with(|| a.name.cmp(&b.name))
    })
}

/// 由记录集重建 记录号 → 完整路径（父链 + 环保护 + 缺失父链跳过）。
pub fn resolve_record_paths(
    records: &[MftRecord],
    drive: &str,
) -> HashMap<u64, (String, FileNameAttr)> {
    let mut chosen: HashMap<u64, (String, u64)> = HashMap::new();
    let mut meta: HashMap<u64, FileNameAttr> = HashMap::new();
    let mut is_dir: std::collections::HashSet<u64> = std::collections::HashSet::new();
    for record in records {
        if !record.in_use || record.is_extent || record.base_record != 0 {
            continue;
        }
        if record.is_directory {
            is_dir.insert(record.record_number);
        }
        if let Some(name) = primary_file_name(record) {
            if name.file_attributes & FILE_ATTR_REPARSE_POINT != 0 {
                continue;
            }
            chosen.insert(record.record_number, (name.name.clone(), name.parent_ref));
            meta.insert(record.record_number, name.clone());
        }
    }

    let mut cache: HashMap<u64, Option<String>> = HashMap::new();
    let mut resolved: HashMap<u64, (String, FileNameAttr)> = HashMap::new();
    for &record_number in chosen.keys() {
        let mut segments = Vec::new();
        let mut current = record_number;
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
            let Some((name, parent)) = chosen.get(&current) else {
                ok = false;
                break;
            };
            if !seen.insert(current) {
                ok = false;
                break;
            }
            segments.push(name.clone());
            current = *parent & MFT_REFERENCE_MASK;
            if current == 0 {
                break;
            }
        }
        if !ok {
            cache.insert(record_number, None);
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
                    cache.insert(record_number, None);
                    continue;
                }
                segments.reverse();
                format!("{drive}/{}", segments.join("/"))
            }
        };
        let attr = meta
            .get(&record_number)
            .cloned()
            .unwrap_or_else(|| FileNameAttr {
                parent_ref: 0,
                creation_ms: 0,
                modified_ms: 0,
                allocated_size: 0,
                data_size: 0,
                file_attributes: 0,
                namespace: 1,
                name: String::new(),
            });
        cache.insert(record_number, Some(full));
        if !is_dir.contains(&record_number) {
            resolved.insert(
                record_number,
                (cache[&record_number].clone().unwrap(), attr),
            );
        }
    }
    resolved
}

fn normalize_prefix(root: &str) -> String {
    let mut s = root.replace('\\', "/");
    if !s.ends_with('/') {
        s.push('/');
    }
    s
}

/// 将路径展开为长路径（8.3 短路径 → 完整路径）；不存在或失败时原样返回。
fn long_path_of(path: &str) -> String {
    let short_wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buf = vec![0u16; LONG_PATH_BUF];
    let len = unsafe { GetLongPathNameW(PCWSTR(short_wide.as_ptr()), Some(&mut buf)) };
    if len != 0 && (len as usize) < buf.len() {
        return String::from_utf16_lossy(&buf[..len as usize]);
    }
    // GetLongPathNameW 可能因权限拒绝（如 8.3 别名路径），退回 canonicalize：
    // Windows 上它内部走 GetFinalPathNameByHandle，返回 \\?\ 前缀的长路径。
    if let Ok(canonical) = std::fs::canonicalize(path) {
        let s = canonical.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
        return s.to_string();
    }
    path.to_string()
}

/// 读取卷布局：记录大小、MFT 起始字节偏移、MFT 有效数据长度。
fn ntfs_volume_mft_layout(volume: HANDLE) -> Result<(u32, u64, u64), String> {
    let mut out = [0u8; 96];
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            volume,
            FSCTL_GET_NTFS_VOLUME_DATA,
            None,
            0,
            Some(out.as_mut_ptr().cast()),
            out.len() as u32,
            Some(&mut returned),
            None,
        )
    }
    .map_err(|e| format!("FSCTL_GET_NTFS_VOLUME_DATA 失败: {e}"))?;
    if returned < 96 {
        return Err("NTFS 卷数据不完整".into());
    }
    let bytes_per_file_record = u32::from_le_bytes(out[48..52].try_into().unwrap());
    let bytes_per_cluster = u32::from_le_bytes(out[44..48].try_into().unwrap());
    let clusters_per_file_record = u32::from_le_bytes(out[52..56].try_into().unwrap());
    let mft_start_lcn = u64::from_le_bytes(out[64..72].try_into().unwrap());
    let mft_valid_len = u64::from_le_bytes(out[56..64].try_into().unwrap());
    let record_size = if bytes_per_file_record != 0 {
        bytes_per_file_record
    } else if clusters_per_file_record != 0 {
        clusters_per_file_record * bytes_per_cluster
    } else {
        return Err("NTFS 记录大小不可确定".into());
    };
    if record_size < 512 || bytes_per_cluster == 0 {
        return Err("NTFS 布局异常".into());
    }
    Ok((
        record_size,
        mft_start_lcn * bytes_per_cluster as u64,
        mft_valid_len,
    ))
}

/// MFT 快速全量扫描（实验性，`ROOTUP_MFT_SCAN=1` + 管理员 + NTFS 才启用）。
/// 与 walkdir 语义对齐：只产出文件（跳过目录/符号链接/重解析点），应用忽略规则。
pub fn try_full_scan(
    root: &str,
    matcher: &IgnoreMatcher,
) -> Result<(Vec<FileEntry>, EnumerateStats), String> {
    if std::env::var_os("ROOTUP_MFT_SCAN").is_none() {
        return Err("MFT 扫描未启用（ROOTUP_MFT_SCAN=1）".into());
    }
    let caps = probe_volume(root);
    log::debug!(
        "scan: MFT 卷探测 fs={} usn={} reason={}",
        caps.fs_name,
        caps.usn_available,
        caps.reason
    );
    if !caps.fs_name.to_ascii_uppercase().contains("NTFS") {
        return Err(format!("非 NTFS 卷（fs={}）", caps.fs_name));
    }
    let Some(drive) = drive_root_of(root) else {
        return Err("无法推导卷根".into());
    };
    // 参考 ntfs-3g win32_io.c：打开卷句柄（GENERIC_READ）并允许扩展 DASD 读取，
    // 按 FSCTL_GET_NTFS_VOLUME_DATA 给出的 MFT 偏移直接 ReadFile，不打开 $MFT。
    let volume_path = format!("\\\\.\\{drive}");
    let wide: Vec<u16> = volume_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }
    .map_err(|e| format!("打开卷 {volume_path} 失败（需要管理员）: {e}"))?;
    let _guard = RawHandle(handle);

    let mut dasd_returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            FSCTL_ALLOW_EXTENDED_DASD_IO,
            None,
            0,
            None,
            0,
            Some(&mut dasd_returned),
            None,
        )
    }
    .map_err(|e| format!("FSCTL_ALLOW_EXTENDED_DASD_IO 失败: {e}"))?;

    let (record_size, mft_offset, mft_valid_len) = ntfs_volume_mft_layout(handle)?;
    let record_size = record_size as usize;
    if mft_valid_len == 0 {
        return Err("MFT 有效数据长度为 0".into());
    }

    let mut records: Vec<MftRecord> = Vec::new();
    let chunk_size = (MFT_READ_TARGET / record_size).max(1) * record_size;
    let mut chunk = vec![0u8; chunk_size];
    let mut position = mft_offset;
    let mut total_read = 0u64;
    let mut progress_logged = 0u64;
    while total_read < mft_valid_len {
        let want = ((mft_valid_len - total_read) as usize).min(chunk_size);
        let mut read = 0u32;
        unsafe { SetFilePointerEx(handle, position as i64, None, FILE_BEGIN) }
            .map_err(|e| format!("SetFilePointerEx 失败: {e}"))?;
        let io = unsafe { ReadFile(handle, Some(&mut chunk[..want]), Some(&mut read), None) };
        if io.is_err() {
            return Err("读取 $MFT 失败".into());
        }
        if read == 0 {
            break;
        }
        let mut off = 0usize;
        while off + record_size <= read as usize {
            let record_buf = &chunk[off..off + record_size];
            if record_buf[0..4] == FILE_RECORD_SIGNATURE {
                if let Ok(record) = parse_file_record(record_buf) {
                    records.push(record);
                }
            }
            off += record_size;
        }
        position += read as u64;
        total_read += read as u64;
        if total_read.saturating_sub(progress_logged) >= MFT_PROGRESS_INTERVAL {
            progress_logged = total_read;
            log::info!(
                "scan: MFT 读取进度 {} MiB / {} MiB",
                total_read / (1024 * 1024),
                mft_valid_len / (1024 * 1024)
            );
        }
    }
    log::info!(
        "scan: MFT 读取完成 records={} read_mb={}",
        records.len(),
        total_read / (1024 * 1024)
    );
    if records.is_empty() {
        return Err("MFT 未解析出任何记录".into());
    }

    let mut stats = EnumerateStats::default();
    let paths = resolve_record_paths(&records, &drive);
    let root_long = long_path_of(root);
    let normalized_root = normalize_prefix(&root_long);
    let root_prefix = normalize_prefix(root);
    let records_by_num: HashMap<u64, &MftRecord> =
        records.iter().map(|r| (r.record_number, r)).collect();
    let mut entries = Vec::new();
    for (record_number, (path, attr)) in paths.iter() {
        let Some(relative) = path.strip_prefix(&normalized_root) else {
            continue;
        };
        let full = normalize_path(&format!("{root_prefix}{relative}"));
        let parts: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
        let name = parts.last().copied().unwrap_or(relative);
        // 与 walkdir 的 filter_entry 对齐：被忽略规则命中的祖先目录整棵跳过。
        let ignored_dir = parts[..parts.len().saturating_sub(1)]
            .iter()
            .any(|seg| matcher.is_ignored(seg));
        if ignored_dir || matcher.is_ignored(name) {
            stats.ignored += 1;
            continue;
        }
        let record = records_by_num.get(record_number).copied();
        let size = record.and_then(|r| r.data_size).unwrap_or(attr.data_size) as i64;
        let modified_ms = record
            .and_then(|r| r.si_modified_ms)
            .unwrap_or(attr.modified_ms);
        stats.discovered += 1;
        entries.push(FileEntry {
            path: full,
            size,
            modified_ms,
            is_dir: false,
            is_symlink: false,
        });
    }
    log::info!("scan: MFT enumerator used dir={root}");
    Ok((entries, stats))
}

struct RawHandle(HANDLE);
impl Drop for RawHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_record_buffer(name: &str, record_number: u32, flags: u16) -> Vec<u8> {
        let record_size = 1024usize;
        let mut buf = vec![0u8; record_size];
        buf[0..4].copy_from_slice(&FILE_RECORD_SIGNATURE);
        // USA：offset=48，count = 1024/512 + 1 = 3
        buf[0x04..0x06].copy_from_slice(&48u16.to_le_bytes());
        buf[0x06..0x08].copy_from_slice(&3u16.to_le_bytes());
        let usa_signature = 0xAAAAu16;
        buf[48..50].copy_from_slice(&usa_signature.to_le_bytes());
        // 每个 512 扇区末尾写入 usa 签名，USA 数组记录原值
        for sector in 0..2 {
            let end = (sector + 1) * 512 - 2;
            let original = read_u16(&buf, end);
            buf[end..end + 2].copy_from_slice(&usa_signature.to_le_bytes());
            buf[50 + sector * 2..52 + sector * 2].copy_from_slice(&original.to_le_bytes());
        }
        buf[0x14..0x16].copy_from_slice(&56u16.to_le_bytes()); // attrs offset
        buf[0x16..0x18].copy_from_slice(&flags.to_le_bytes());
        buf[0x2C..0x30].copy_from_slice(&record_number.to_le_bytes());

        // FILE_NAME 属性（resident）
        let units: Vec<u16> = name.encode_utf16().collect();
        let value_len = 0x42 + units.len() * 2;
        let attr_len = 24 + value_len;
        buf[56..60].copy_from_slice(&ATTR_FILE_NAME.to_le_bytes());
        buf[60..64].copy_from_slice(&(attr_len as u32).to_le_bytes());
        buf[72..76].copy_from_slice(&(value_len as u32).to_le_bytes());
        buf[76..78].copy_from_slice(&24u16.to_le_bytes());
        let value = 56 + 24;
        buf[value + 0x28..value + 0x30].copy_from_slice(&12345u64.to_le_bytes()); // allocated
        buf[value + 0x30..value + 0x38].copy_from_slice(&6789u64.to_le_bytes()); // data size
        buf[value + 0x38..value + 0x3C].copy_from_slice(&0u32.to_le_bytes()); // flags
        buf[value + 0x40] = units.len() as u8;
        buf[value + 0x41] = 1; // Win32
        for (i, unit) in units.iter().enumerate() {
            buf[value + 0x42 + i * 2..value + 0x44 + i * 2].copy_from_slice(&unit.to_le_bytes());
        }
        // 记录大小与 END 属性
        buf[0x18..0x1C].copy_from_slice(&((value + value_len + 8) as u32).to_le_bytes());
        let end_off = value + value_len;
        buf[end_off..end_off + 4].copy_from_slice(&ATTR_END.to_le_bytes());
        buf[end_off + 4..end_off + 8].copy_from_slice(&8u32.to_le_bytes());
        buf
    }

    #[test]
    fn parses_file_name_record_with_fixups() {
        let buf = base_record_buffer("报告.pdf", 42, 0x01);
        let record = parse_file_record(&buf).unwrap();
        assert_eq!(record.record_number, 42);
        assert!(record.in_use);
        assert!(!record.is_directory);
        assert!(!record.is_extent);
        assert_eq!(record.file_names.len(), 1);
        let name = &record.file_names[0];
        assert_eq!(name.name, "报告.pdf");
        assert_eq!(name.data_size, 6789);
        assert_eq!(name.allocated_size, 12345);
        assert_eq!(name.namespace, 1);
    }

    #[test]
    fn rejects_truncated_and_corrupted_records() {
        let buf = base_record_buffer("a.txt", 1, 0x01);
        assert!(parse_file_record(&buf[..48]).is_err());
        assert!(parse_file_record(&buf[..400]).is_err());
        let mut corrupted = buf.clone();
        corrupted[0x16..0x18].copy_from_slice(&0xFFFFu16.to_le_bytes());
        corrupted[10] ^= 0xFF;
        // 损坏的 USA 或属性区应返回 Err 或不产生非法字段
        let _ = parse_file_record(&corrupted);
    }

    #[test]
    fn deterministic_fuzz_never_panics() {
        let mut seed = 0x9E3779B97F4A7C15u64;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..2000 {
            let len = (next() % 2048) as usize;
            let mut buf = vec![0u8; len];
            for b in buf.iter_mut() {
                *b = next() as u8;
            }
            let _ = parse_file_record(&buf);
        }
    }

    #[test]
    fn primary_name_prefers_win32_namespace_and_lexicographic_min() {
        let mut record = parse_file_record(&base_record_buffer("b.txt", 1, 0x01)).unwrap();
        record.file_names.push(FileNameAttr {
            parent_ref: 0,
            creation_ms: 0,
            modified_ms: 0,
            allocated_size: 0,
            data_size: 0,
            file_attributes: 0,
            namespace: 0,
            name: "a.txt".into(),
        });
        record.file_names.push(FileNameAttr {
            parent_ref: 0,
            creation_ms: 0,
            modified_ms: 0,
            allocated_size: 0,
            data_size: 0,
            file_attributes: 0,
            namespace: 2,
            name: "B.TXT".into(),
        });
        assert_eq!(primary_file_name(&record).unwrap().name, "b.txt");
    }

    #[test]
    fn resolve_record_paths_skips_extents_dirs_reparse_and_cycles() {
        let mut root = parse_file_record(&base_record_buffer("root", 3, 0x03)).unwrap();
        root.is_directory = true;
        let mut dir = parse_file_record(&base_record_buffer("dir", 2, 0x03)).unwrap();
        dir.is_directory = true;
        let file = parse_file_record(&base_record_buffer("a.txt", 1, 0x01)).unwrap();
        let mut reparse = parse_file_record(&base_record_buffer("link", 5, 0x01)).unwrap();
        reparse.file_names[0].file_attributes |= FILE_ATTR_REPARSE_POINT;

        let mut records = vec![root, dir, file, reparse];
        // 父引用：a.txt 的父 = 2，dir 的父 = 3
        // 使用带序号的打包 MFT 引用验证掩码（高 16 位序号应被剥离）。
        records[0].file_names[0].parent_ref = 0;
        records[1].file_names[0].parent_ref = (0x0100u64 << 48) | 3;
        records[2].file_names[0].parent_ref = (0x0101u64 << 48) | 2;
        let mut cycle_a = parse_file_record(&base_record_buffer("ca", 7, 0x01)).unwrap();
        let mut cycle_b = parse_file_record(&base_record_buffer("cb", 8, 0x01)).unwrap();
        cycle_a.file_names[0].parent_ref = (0x0200u64 << 48) | 8;
        cycle_b.file_names[0].parent_ref = (0x0201u64 << 48) | 7;
        records.extend([cycle_a, cycle_b]);

        let paths = resolve_record_paths(&records, "C:");
        assert_eq!(
            paths.get(&1).map(|(p, _)| p.as_str()),
            Some("C:/root/dir/a.txt")
        );
        assert!(!paths.contains_key(&5), "重解析点不应产出");
        assert!(!paths.contains_key(&7), "父链成环不应产出");
    }

    #[test]
    fn fast_scan_requires_env_flag() {
        std::env::remove_var("ROOTUP_MFT_SCAN");
        let matcher = IgnoreMatcher::new();
        assert!(try_full_scan("C:/", &matcher).is_err());
    }
}
