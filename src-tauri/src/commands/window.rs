use crate::core::index::IndexStore;
use crate::infra::window;
use crate::infra::window::QuitFlag;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

/// 关闭确认弹窗中选择"后台运行"：销毁窗口，仅保留托盘。
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    window::destroy_main_window(&app).map_err(|e| e.to_string())
}

/// 关闭确认弹窗中选择"退出程序"：完全退出应用。
#[tauri::command]
pub fn quit_app(app: AppHandle, quit_flag: State<QuitFlag>) {
    quit_flag.0.store(true, Ordering::SeqCst);
    if let Some(store) = app.try_state::<Arc<Mutex<dyn IndexStore>>>() {
        let _ = store.lock().map(|mut s| s.maintenance());
    }
    app.exit(0);
}
