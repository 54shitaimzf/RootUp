//! 学业数据命令：加载/保存/存在性/定向重分类。
use crate::core::classify::{ClassifierChain, ExtensionClassifier};
use crate::core::index::IndexStore;
use crate::core::study::{ensure_label_keys, validate_study_data, StudyData};
use crate::core::study_classify::{reapply_labels, SharedStudyClassifier, StudyClassifier};
use crate::infra::storage;
use crate::infra::study_store::{JsonStudyStore, StudyStore};
use crate::infra::tray;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

fn store(app: &AppHandle) -> Result<JsonStudyStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("study: 无法获取数据目录: {e}"))?;
    Ok(JsonStudyStore::new(dir.join("study.json")))
}

#[tauri::command]
pub fn get_study_data(app: AppHandle) -> Result<StudyData, String> {
    let store = store(&app)?;
    let data = store.load();
    log::info!(
        "study: 加载 semesters={} courses={}",
        data.semesters.len(),
        data.courses_by_semester
            .values()
            .map(Vec::len)
            .sum::<usize>()
    );
    Ok(data)
}

#[tauri::command]
pub fn study_store_exists(app: AppHandle) -> Result<bool, String> {
    Ok(store(&app)?.exists())
}

/// 定向重分类：用完整分类链（扩展名 + 课程）重算存量文件标签。
fn reapply(app: &AppHandle) -> Result<i64, String> {
    let settings = storage::load_settings(app);
    let overrides: Vec<(Vec<String>, String)> = settings
        .classify_overrides
        .iter()
        .map(|rule| (rule.extensions.clone(), rule.category.clone()))
        .collect();
    let shared = app.state::<Arc<Mutex<StudyClassifier>>>().inner().clone();
    let mut chain =
        ClassifierChain::new(vec![
            Box::new(ExtensionClassifier::with_overrides(&overrides))
                as Box<dyn crate::core::classify::Classifier>,
        ]);
    chain.push(Box::new(SharedStudyClassifier(shared)));
    let store = app.state::<Arc<Mutex<dyn IndexStore>>>();
    let mut store = store.lock().map_err(|e| e.to_string())?;
    let changed = reapply_labels(&mut *store, &chain)?;
    log::info!("classify: 重新应用课程标签 count={changed}");
    Ok(changed)
}

#[tauri::command]
pub fn save_study_data(app: AppHandle, mut data: StudyData) -> Result<StudyData, String> {
    ensure_label_keys(&mut data);
    validate_study_data(&data)?;
    store(&app)?.save(&data)?;
    let classifier = app.state::<Arc<Mutex<StudyClassifier>>>();
    classifier.lock().map_err(|e| e.to_string())?.refresh(&data);
    let changed = reapply(&app)?;
    let _ = tray::refresh_tray(&app);
    let total_courses: usize = data.courses_by_semester.values().map(Vec::len).sum();
    log::info!(
        "study: 保存 semesters={} courses={total_courses} labels={changed}",
        data.semesters.len()
    );
    Ok(data)
}

#[tauri::command]
pub fn reapply_study_labels(app: AppHandle) -> Result<i64, String> {
    reapply(&app)
}
