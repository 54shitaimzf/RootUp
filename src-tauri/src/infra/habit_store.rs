//! 筛选习惯文件存储：`habits.json`（应用数据目录）。
//!
//! 独立于 settings；写入采用“临时文件 + rename”保证原子性；
//! 文件损坏时备份为 `habits.json.corrupt-<ts>.bak` 并回退空表。
use crate::core::habits::FilterHabits;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const HABITS_FILE: &str = "habits.json";

/// 习惯存储契约：命令层只依赖该接口。
pub trait HabitStore: Send + Sync {
    fn load(&self) -> FilterHabits;
    fn save(&self, habits: &FilterHabits) -> Result<(), String>;
}

/// JSON 文件实现。
pub struct JsonHabitStore {
    path: PathBuf,
}

impl JsonHabitStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn read(&self) -> FilterHabits {
        if !self.path.exists() {
            return FilterHabits::new();
        }
        match fs::read_to_string(&self.path) {
            Ok(raw) => match serde_json::from_str::<FilterHabits>(&raw) {
                Ok(habits) => habits,
                Err(e) => {
                    log::warn!("habits: 文件损坏回退空表: {e}");
                    if let Err(e) = backup_corrupt_habits(&self.path) {
                        log::warn!("habits: 损坏备份失败: {e}");
                    }
                    FilterHabits::new()
                }
            },
            Err(e) => {
                log::warn!("habits: 读取失败: {e}");
                FilterHabits::new()
            }
        }
    }

    fn write_atomic(&self, habits: &FilterHabits) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("habits: 创建目录失败: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let raw = serde_json::to_string_pretty(habits).map_err(|e| e.to_string())?;
        fs::write(&tmp, raw).map_err(|e| format!("habits: 写入临时文件失败: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("habits: 原子替换失败: {e}")
        })
    }
}

impl HabitStore for JsonHabitStore {
    fn load(&self) -> FilterHabits {
        self.read()
    }

    fn save(&self, habits: &FilterHabits) -> Result<(), String> {
        self.write_atomic(habits)
    }
}

/// 检测损坏的 `habits.json` 并改名为备份文件；返回备份路径。
pub fn backup_corrupt_habits(path: impl AsRef<Path>) -> Result<Option<PathBuf>, String> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(None);
    }
    let readable = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .is_some();
    if readable {
        return Ok(None);
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup = path.with_file_name(format!("{HABITS_FILE}.corrupt-{ts}.bak"));
    fs::rename(path, &backup).map_err(|e| format!("备份失败: {e}"))?;
    log::warn!("habits: 损坏备份 -> {}", backup.display());
    Ok(Some(backup))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::habits::Habit;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_habit_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_empty_and_no_backup() {
        let dir = temp_dir("missing");
        assert_eq!(
            backup_corrupt_habits(dir.join("habits.json")).unwrap(),
            None
        );
        let store = JsonHabitStore::new(dir.join("habits.json"));
        assert!(store.load().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = temp_dir("roundtrip");
        let store = JsonHabitStore::new(dir.join("habits.json"));
        let mut habits = FilterHabits::new();
        habits.insert(
            "category:document".into(),
            Habit {
                count: 3,
                last_used: 1000,
            },
        );
        store.save(&habits).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded["category:document"].count, 3);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_file_backed_up_and_falls_back_empty() {
        let dir = temp_dir("corrupt");
        let path = dir.join("habits.json");
        fs::write(&path, "{ 这不是合法 JSON").unwrap();
        let backup = backup_corrupt_habits(&path).unwrap().expect("应生成备份");
        assert!(backup.exists());
        assert!(!path.exists());
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("habits.json.corrupt-"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_leaves_no_tmp_file() {
        let dir = temp_dir("atomic");
        let store = JsonHabitStore::new(dir.join("habits.json"));
        let mut habits = FilterHabits::new();
        habits.insert(
            "label:高数".into(),
            Habit {
                count: 1,
                last_used: 1,
            },
        );
        store.save(&habits).unwrap();
        assert!(!dir.join("habits.json.tmp").exists());
        assert!(store.load().contains_key("label:高数"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
