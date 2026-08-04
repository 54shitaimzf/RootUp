//! 筛选习惯文件存储：`habits.json`（应用数据目录）。
//!
//! 独立于 settings；写入采用“临时文件 + rename”保证原子性；
//! 文件损坏时备份为 `habits.json.corrupt-<ts>.bak` 并回退空表。
use crate::core::habits::FilterHabits;
use crate::infra::local_file;
use std::path::PathBuf;

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
        match local_file::read_json::<FilterHabits>(&self.path) {
            Ok(Some(habits)) => habits,
            Ok(None) => FilterHabits::new(),
            Err(e) => {
                log::warn!("habits: 读取失败: {e}");
                FilterHabits::new()
            }
        }
    }

    fn write_atomic(&self, habits: &FilterHabits) -> Result<(), String> {
        local_file::write_json_atomic(&self.path, habits)
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

/// 兼容旧测试的损坏备份入口，统一走 local_file 层。
#[cfg(test)]
pub fn backup_corrupt_habits(path: impl AsRef<std::path::Path>) -> Result<Option<PathBuf>, String> {
    local_file::backup_corrupt_file(path.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::habits::Habit;
    use std::fs;

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
