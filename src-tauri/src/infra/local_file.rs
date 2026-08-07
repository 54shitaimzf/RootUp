//! 统一本地 JSON 文件层：读取（损坏备份回退）、原子写、损坏备份。
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 读取 JSON：缺失返回 Ok(None)；解析失败备份 `*.corrupt-<ts>.bak` 后返回 Ok(None)；IO 错误返回 Err。
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("读取文件失败: {e}"))?;
    match serde_json::from_str::<T>(&raw) {
        Ok(value) => Ok(Some(value)),
        Err(e) => {
            log::warn!("local_file: 文件损坏回退: {e}");
            if let Err(backup_err) = backup_corrupt_file(path) {
                log::warn!("local_file: 损坏备份失败: {backup_err}");
            }
            Ok(None)
        }
    }
}

/// 原子写：建父目录 → 写临时文件 → rename，失败清理临时文件。
pub fn write_json_atomic<T: ?Sized + Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("原子替换失败: {e}")
    })
}

/// 损坏备份：把文件改名为 `<name>.corrupt-<ts>.bak`。
pub fn backup_corrupt_file(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.json".into());
    let backup = path.with_file_name(format!("{name}.corrupt-{ts}.bak"));
    fs::rename(path, &backup).map_err(|e| format!("损坏备份失败: {e}"))?;
    log::warn!("local_file: 损坏备份 -> {}", backup.display());
    if let Some(dir) = path.parent() {
        prune_corrupt_backups(dir, &name, 3)?;
    }
    Ok(Some(backup))
}

/// 保留最近 `keep` 份 `<base>.corrupt-<ts>.bak`，删除更早的备份（按文件名排序，时间戳同宽）。
pub fn prune_corrupt_backups(dir: &Path, base_name: &str, keep: usize) -> Result<(), String> {
    let prefix = format!("{base_name}.corrupt-");
    let mut backups: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && name.ends_with(".bak") {
                backups.push(entry.path());
            }
        }
    }
    backups.sort();
    if backups.len() > keep {
        for old in backups.iter().take(backups.len() - keep) {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rootup-local-file-test-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_returns_none() {
        let dir = temp_dir("missing");
        let path = dir.join("a.json");
        assert_eq!(read_json::<serde_json::Value>(&path).unwrap(), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_read_roundtrip() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("nested").join("b.json");
        write_json_atomic(&path, &vec!["a", "b"]).unwrap();
        let value: Vec<String> = read_json(&path).unwrap().unwrap();
        assert_eq!(value, vec!["a".to_string(), "b".to_string()]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_backed_up_and_returns_none() {
        let dir = temp_dir("corrupt");
        let path = dir.join("c.json");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(read_json::<serde_json::Value>(&path).unwrap(), None);
        let backups = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert!(backups >= 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_leaves_no_tmp_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("d.json");
        write_json_atomic(&path, &"ok").unwrap();
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_backups_keep_only_latest_three() {
        let dir = temp_dir("prune");
        for ts in 1000..1005 {
            fs::write(dir.join(format!("x.json.corrupt-{ts}.bak")), "x").unwrap();
        }
        prune_corrupt_backups(&dir, "x.json", 3).unwrap();
        let remaining = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert_eq!(remaining, 3);
        assert!(!dir.join("x.json.corrupt-1000.bak").exists());
        assert!(!dir.join("x.json.corrupt-1001.bak").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
