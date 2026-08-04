//! 学业数据存储：`study.json`（应用数据目录），原子写 + 损坏备份。
use crate::core::study::{seed_study_data, StudyData};
use crate::infra::local_file;
use std::path::PathBuf;

pub trait StudyStore: Send + Sync {
    fn load(&self) -> StudyData;
    fn save(&self, data: &StudyData) -> Result<(), String>;
    fn exists(&self) -> bool;
}

pub struct JsonStudyStore {
    path: PathBuf,
}

impl JsonStudyStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl StudyStore for JsonStudyStore {
    fn load(&self) -> StudyData {
        match local_file::read_json::<StudyData>(&self.path) {
            Ok(Some(data)) => data,
            Ok(None) => seed_study_data(),
            Err(e) => {
                log::warn!("study: 读取失败: {e}");
                seed_study_data()
            }
        }
    }

    fn save(&self, data: &StudyData) -> Result<(), String> {
        local_file::write_json_atomic(&self.path, data)
    }

    fn exists(&self) -> bool {
        self.path.exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_store(tag: &str) -> JsonStudyStore {
        let dir =
            std::env::temp_dir().join(format!("rootup-study-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        JsonStudyStore::new(dir.join("study.json"))
    }

    #[test]
    fn missing_file_returns_seed() {
        let store = temp_store("missing");
        assert!(!store.exists());
        assert_eq!(store.load().semesters.len(), 2);
    }

    #[test]
    fn save_load_roundtrip() {
        let store = temp_store("roundtrip");
        let mut data = seed_study_data();
        data.semesters[0].name = "自定义学期".into();
        store.save(&data).unwrap();
        assert!(store.exists());
        assert_eq!(store.load().semesters[0].name, "自定义学期");
    }

    #[test]
    fn corrupt_file_backed_up_and_fallback_seed() {
        let store = temp_store("corrupt");
        fs::write(&store.path, "{ not json").unwrap();
        assert_eq!(store.load().semesters[0].id, "fall-2026");
        let backups = fs::read_dir(store.path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert!(backups >= 1);
    }
}
