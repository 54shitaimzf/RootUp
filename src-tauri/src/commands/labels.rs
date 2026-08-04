//! 自定义标签注册表命令：列表 / 保存（按 key upsert）/ 删除。
use crate::core::labels::{valid_key, valid_name, valid_style, LabelDef};
use crate::infra::label_store::{JsonLabelStore, LabelStore};
use tauri::{AppHandle, Manager};

fn store(app: &AppHandle) -> Result<JsonLabelStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("labels: 无法获取数据目录: {e}"))?;
    Ok(JsonLabelStore::new(dir.join("labels.json")))
}

#[tauri::command]
pub fn list_label_defs(app: AppHandle) -> Result<Vec<LabelDef>, String> {
    Ok(store(&app)?.list())
}

#[tauri::command]
pub fn save_label_def(app: AppHandle, def: LabelDef) -> Result<LabelDef, String> {
    let mut def = def;
    def.key = def.key.trim().to_lowercase();
    def.name = def.name.trim().to_string();
    def.icon = def.icon.trim().to_lowercase();
    def.color = def.color.trim().to_lowercase();
    if !valid_key(&def.key) {
        return Err("标签 key 仅支持小写字母、数字与连字符（≤32）".to_string());
    }
    if !valid_name(&def.name) {
        return Err("标签名称需为 1–40 字符".to_string());
    }
    if !valid_style(&def.icon) || !valid_style(&def.color) {
        return Err("标签图标或颜色无效".to_string());
    }
    store(&app)?.save(def.clone())?;
    log::info!("labels: 保存 key={} name=\"{}\"", def.key, def.name);
    Ok(def)
}

#[tauri::command]
pub fn delete_label_def(app: AppHandle, key: String) -> Result<(), String> {
    store(&app)?.delete(&key)?;
    log::info!("labels: 删除 key={key}");
    Ok(())
}
