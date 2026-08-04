//! 学业数据存储：`study.json`（应用数据目录），原子写 + 损坏备份。
use crate::core::study::{seed_study_data, StudyData};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const STUDY_FILE: &str = "study.json";

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

fn backup_corrupt(path: &Path) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| STUDY_FILE.to_string());
    let backup = path.with_file_name(format!("{name}.corrupt-{ts}.bak"));
    if let Err(e) = fs::rename(path, &backup) {
        log::warn!("study: 损坏备份失败: {e}");
    } else {
        log::warn!("study: 损坏备份 -> {}", backup.display());
    }
}

impl StudyStore for JsonStudyStore {
    fn load(&self) -> StudyData {
        if !self.path.exists() {
            return seed_study_data();
        }
        match fs::read_to_string(&self.path) {
            Ok(raw) => match serde_json::from_str::<StudyData>(&raw) {
                Ok(data) => data,
                Err(e) => {
                    log::warn!("study: 文件损坏回退种子: {e}");
                    backup_corrupt(&self.path);
                    seed_study_data()
                }
            },
            Err(e) => {
                log::warn!("study: 读取失败: {e}");
                seed_study_data()
            }
        }
    }

    fn save(&self, data: &StudyData) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("study: 创建目录失败: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let raw = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        fs::write(&tmp, raw).map_err(|e| format!("study: 写入临时文件失败: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("study: 原子替换失败: {e}")
        })
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
        JsonStudyStore::new(dir.join(STUDY_FILE))
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
