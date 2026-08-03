//! 筛选习惯命令：读取 / 保存。
use crate::core::habits::{habits_valid, FilterHabits};
use crate::infra::habit_store::{HabitStore, JsonHabitStore};
use tauri::{AppHandle, Manager};

fn store(app: &AppHandle) -> Result<JsonHabitStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("habits: 无法获取数据目录: {e}"))?;
    Ok(JsonHabitStore::new(dir.join("habits.json")))
}

#[tauri::command]
pub fn get_habits(app: AppHandle) -> Result<FilterHabits, String> {
    Ok(store(&app)?.load())
}

#[tauri::command]
pub fn save_habits(app: AppHandle, habits: FilterHabits) -> Result<(), String> {
    if !habits_valid(&habits) {
        return Err("habits: 数据无效".to_string());
    }
    store(&app)?.save(&habits)?;
    log::info!("habits: 保存 {} 条", habits.len());
    Ok(())
}
