//! 规则方案文件存储：`schemes.json`（应用数据目录）。
//!
//! 独立于 settings 存储；写入采用“临时文件 + rename”保证原子性；
//! 文件损坏时备份为 `schemes.json.corrupt-<ts>.bak` 并回退为空列表。
use crate::core::schemes::{RuleScheme, MAX_SCHEMES};
use crate::infra::local_file;
use std::path::PathBuf;

/// 方案存储契约：命令层只依赖该接口。
pub trait SchemeStore: Send + Sync {
    fn list(&self) -> Vec<RuleScheme>;
    fn save(&self, scheme: RuleScheme) -> Result<(), String>;
    fn rename(&self, id: &str, name: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

/// JSON 文件实现。
pub struct JsonSchemeStore {
    path: PathBuf,
}

impl JsonSchemeStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Vec<RuleScheme> {
        match local_file::read_json::<Vec<RuleScheme>>(&self.path) {
            Ok(Some(schemes)) => schemes,
            Ok(None) => Vec::new(),
            Err(e) => {
                log::warn!("schemes: 读取失败: {e}");
                Vec::new()
            }
        }
    }

    fn write_atomic(&self, schemes: &[RuleScheme]) -> Result<(), String> {
        local_file::write_json_atomic(&self.path, schemes)
    }
}

impl SchemeStore for JsonSchemeStore {
    fn list(&self) -> Vec<RuleScheme> {
        self.load()
    }

    fn save(&self, scheme: RuleScheme) -> Result<(), String> {
        let mut schemes = self.load();
        if schemes.iter().any(|s| s.name == scheme.name) {
            return Err("方案名称已存在".to_string());
        }
        if schemes.len() >= MAX_SCHEMES {
            return Err(format!("自定义方案已达上限（{MAX_SCHEMES} 个）"));
        }
        schemes.push(scheme);
        self.write_atomic(&schemes)
    }

    fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let schemes = self.load();
        if !schemes.iter().any(|s| s.id == id) {
            return Err("方案不存在".to_string());
        }
        if schemes.iter().any(|s| s.id != id && s.name == name) {
            return Err("方案名称已存在".to_string());
        }
        let mut updated: Vec<RuleScheme> = schemes
            .into_iter()
            .map(|mut s| {
                if s.id == id {
                    s.name = name.to_string();
                }
                s
            })
            .collect();
        updated.shrink_to_fit();
        self.write_atomic(&updated)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        let mut schemes = self.load();
        let before = schemes.len();
        schemes.retain(|s| s.id != id);
        if schemes.len() == before {
            return Err("方案不存在".to_string());
        }
        self.write_atomic(&schemes)
    }
}

/// 兼容旧测试的损坏备份入口，统一走 local_file 层。
#[cfg(test)]
pub fn backup_corrupt_schemes(
    path: impl AsRef<std::path::Path>,
) -> Result<Option<PathBuf>, String> {
    local_file::backup_corrupt_file(path.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::settings::{ClassifyRule, Settings};
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_scheme_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scheme(id: &str, name: &str) -> RuleScheme {
        RuleScheme {
            id: id.into(),
            name: name.into(),
            ignore_rules: Settings::default().ignore_rules,
            classify_overrides: vec![ClassifyRule {
                extensions: vec!["psd".into()],
                category: "image".into(),
            }],
        }
    }

    #[test]
    fn crud_round_trip() {
        let dir = temp_dir("crud");
        let store = JsonSchemeStore::new(dir.join("schemes.json"));
        assert!(store.list().is_empty());

        store.save(scheme("s1", "方案一")).unwrap();
        store.save(scheme("s2", "方案二")).unwrap();
        assert_eq!(store.list().len(), 2);

        store.rename("s1", "方案一改").unwrap();
        let names: Vec<String> = store.list().into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"方案一改".to_string()));

        store.delete("s2").unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].id, "s1");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn duplicate_name_rejected() {
        let dir = temp_dir("dup");
        let store = JsonSchemeStore::new(dir.join("schemes.json"));
        store.save(scheme("s1", "同名")).unwrap();
        let err = store.save(scheme("s2", "同名")).unwrap_err();
        assert!(err.contains("已存在"));
        // 重命名到同名同样拒绝
        store.save(scheme("s2", "另一名")).unwrap();
        let err = store.rename("s2", "同名").unwrap_err();
        assert!(err.contains("已存在"));
        // 自身改名不受影响
        store.rename("s2", "二").unwrap();
        assert!(store.list().iter().any(|s| s.id == "s2" && s.name == "二"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_file_is_empty_and_no_backup() {
        let dir = temp_dir("missing");
        assert_eq!(
            backup_corrupt_schemes(dir.join("schemes.json")).unwrap(),
            None
        );
        let store = JsonSchemeStore::new(dir.join("schemes.json"));
        assert!(store.list().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_file_backed_up_and_falls_back_empty() {
        let dir = temp_dir("corrupt");
        let path = dir.join("schemes.json");
        fs::write(&path, "{ 这不是合法 JSON").unwrap();
        let backup = backup_corrupt_schemes(&path).unwrap().expect("应生成备份");
        assert!(backup.exists());
        assert!(!path.exists());
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("schemes.json.corrupt-"));

        fs::write(&path, "{ 再次损坏").unwrap();
        let store = JsonSchemeStore::new(path.clone());
        assert!(store.list().is_empty());
        assert!(!path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unknown_fields_tolerated_on_load() {
        let dir = temp_dir("unknown");
        let path = dir.join("schemes.json");
        fs::write(&path, r#"[{"id":"s1","name":"方案","future_field":123}]"#).unwrap();
        let store = JsonSchemeStore::new(path);
        assert_eq!(store.list().len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_leaves_no_tmp_file() {
        let dir = temp_dir("atomic");
        let store = JsonSchemeStore::new(dir.join("schemes.json"));
        store.save(scheme("s1", "方案")).unwrap();
        assert!(!dir.join("schemes.json.tmp").exists());
        let parsed: Vec<RuleScheme> =
            serde_json::from_str(&fs::read_to_string(store.path).unwrap()).unwrap();
        assert_eq!(parsed.len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
