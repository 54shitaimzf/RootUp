use crate::infra::window;
use tauri::AppHandle;

/// 关闭确认弹窗中选择"后台运行"：销毁窗口，仅保留托盘。
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    window::destroy_main_window(&app).map_err(|e| e.to_string())
}

/// 关闭确认弹窗中选择"退出程序"：完全退出应用。
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
