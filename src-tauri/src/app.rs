use crate::commands::settings as settings_commands;
use crate::commands::window as window_commands;
use crate::infra::tray;
use crate::infra::window as window_lifecycle;
use tauri::{Emitter, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        // 单实例：重复启动时唤起已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = window_lifecycle::ensure_main_window(app);
        }))
        // 设置持久化存储
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            settings_commands::get_settings,
            settings_commands::set_settings,
            window_commands::hide_to_tray,
            window_commands::quit_app,
        ])
        // 关闭请求：拦截并通知前端弹出确认弹窗，由用户决定后台运行或退出
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .setup(|app| {
            tray::init(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("RootUp 启动失败");
}
