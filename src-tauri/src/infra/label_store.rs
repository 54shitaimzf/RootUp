//! 自定义标签注册表文件存储：`labels.json`（应用数据目录）。
//!
//! 独立于 settings / schemes 存储；写入采用“临时文件 + rename”原子性；
//! 文件损坏时备份 `labels.corrupt-<ts>.bak` 并回退空表。
use crate::core::labels::{LabelDef, MAX_LABELS};
use crate::infra::local_file;
use std::path::PathBuf;

/// 标签注册表存储契约：命令层只依赖该接口。
pub trait LabelStore: Send + Sync {
    fn list(&self) -> Vec<LabelDef>;
    fn save(&self, def: LabelDef) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

/// JSON 文件实现。
pub struct JsonLabelStore {
    path: PathBuf,
}

impl JsonLabelStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Vec<LabelDef> {
        match local_file::read_json::<Vec<LabelDef>>(&self.path) {
            Ok(Some(defs)) => defs,
            Ok(None) => Vec::new(),
            Err(e) => {
                log::warn!("labels: 读取失败: {e}");
                Vec::new()
            }
        }
    }

    fn write_atomic(&self, defs: &[LabelDef]) -> Result<(), String> {
        local_file::write_json_atomic(&self.path, defs)
    }
}

impl LabelStore for JsonLabelStore {
    fn list(&self) -> Vec<LabelDef> {
        self.load()
    }

    fn save(&self, def: LabelDef) -> Result<(), String> {
        if !def.is_valid() {
            return Err("标签定义无效".to_string());
        }
        let name = def.name.trim().to_string();
        if !crate::core::labels::valid_name(&name) {
            return Err("标签名称无效".to_string());
        }
        let mut defs = self.load();
        if defs.iter().any(|d| d.key != def.key && d.name == name) {
            return Err("标签名称已存在".to_string());
        }
        if let Some(existing) = defs.iter_mut().find(|d| d.key == def.key) {
            existing.name = name;
            existing.icon = def.icon;
            existing.color = def.color;
        } else {
            if defs.len() >= MAX_LABELS {
                return Err(format!("自定义标签已达上限（{MAX_LABELS} 个）"));
            }
            defs.push(LabelDef {
                key: def.key,
                name,
                icon: def.icon,
                color: def.color,
            });
        }
        self.write_atomic(&defs)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        let defs = self.load();
        if !defs.iter().any(|d| d.key == key) {
            return Err("标签不存在".to_string());
        }
        let next: Vec<LabelDef> = defs.into_iter().filter(|d| d.key != key).collect();
        self.write_atomic(&next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_store(tag: &str) -> JsonLabelStore {
        let dir =
            std::env::temp_dir().join(format!("rootup-labels-test-{}-{tag}", std::process::id()));
        let path = dir.join("labels.json");
        let _ = fs::remove_file(&path);
        JsonLabelStore::new(path)
    }

    fn def(key: &str, name: &str) -> LabelDef {
        LabelDef {
            key: key.into(),
            name: name.into(),
            icon: "tag".into(),
            color: "slate".into(),
        }
    }

    #[test]
    fn missing_file_returns_empty() {
        let store = temp_store("missing");
        assert!(store.list().is_empty());
    }

    #[test]
    fn save_list_update_delete_roundtrip() {
        let store = temp_store("roundtrip");
        store.save(def("course", "课程资料")).unwrap();
        store.save(def("math", "数学")).unwrap();
        assert_eq!(store.list().len(), 2);

        store
            .save(LabelDef {
                key: "course".into(),
                name: "课程改名".into(),
                icon: "book".into(),
                color: "sky".into(),
            })
            .unwrap();
        let list = store.list();
        assert_eq!(list.len(), 2);
        assert_eq!(
            list.iter().find(|d| d.key == "course").unwrap().name,
            "课程改名"
        );
        assert_eq!(
            list.iter().find(|d| d.key == "course").unwrap().icon,
            "book"
        );

        store.delete("math").unwrap();
        assert_eq!(store.list().len(), 1);
        assert!(store.delete("math").is_err());
    }

    #[test]
    fn duplicate_name_rejected() {
        let store = temp_store("dupname");
        store.save(def("course", "课程资料")).unwrap();
        assert!(store.save(def("math", "课程资料")).is_err());

        store.save(def("math", "数学")).unwrap();
        assert!(store.save(def("math", "课程资料")).is_err());
    }

    #[test]
    fn limit_enforced() {
        let store = temp_store("limit");
        for i in 0..MAX_LABELS {
            store
                .save(def(&format!("k{i}"), &format!("标签{i}")))
                .unwrap();
        }
        assert!(store.save(def("overflow", "超限标签")).is_err());
    }

    #[test]
    fn invalid_def_rejected_by_store() {
        let store = temp_store("invalid");
        assert!(store.save(def("", "空 key")).is_err());
        assert!(store.save(def("bad key", "名称")).is_err());
    }

    #[test]
    fn corrupt_file_backed_up_and_fallback_empty() {
        let store = temp_store("corrupt");
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        fs::write(&store.path, "{ not json").unwrap();
        assert!(store.list().is_empty());
        let backups = fs::read_dir(store.path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert!(backups >= 1);
    }

    #[test]
    fn unknown_fields_tolerated_on_load() {
        let store = temp_store("unknown");
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        fs::write(
            &store.path,
            r#"[{"key":"course","name":"课程","icon":"book","color":"sky","future":1}]"#,
        )
        .unwrap();
        let list = store.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "课程");
    }
}
