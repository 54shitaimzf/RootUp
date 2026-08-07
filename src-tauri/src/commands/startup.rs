//! 启动生命周期命令：前端加载完成后通知后端启动延迟服务。
use crate::infra::startup;
use tauri::AppHandle;

#[tauri::command]
pub fn app_ready(app: AppHandle) -> Result<(), String> {
    log::info!("startup: 前端就绪");
    startup::start_deferred_services(&app)
}
