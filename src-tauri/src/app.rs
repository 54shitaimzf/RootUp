use crate::commands::settings as settings_commands;
use crate::commands::window as window_commands;
use crate::infra::tray;
use crate::infra::window as window_lifecycle;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// 主动退出标志。
///
/// Tauri 默认在最后一个窗口销毁时触发 `RunEvent::ExitRequested` 并退出进程，
/// 这会让"后台运行（关闭即销毁）"失效。因此事件循环中默认阻止退出，
/// 仅当用户明确选择退出（托盘菜单 / 确认弹窗）并先置位此标志时才放行。
pub struct QuitFlag(pub Arc<AtomicBool>);

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
        .manage(QuitFlag(Arc::new(AtomicBool::new(false))))
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
        .build(tauri::generate_context!())
        .expect("RootUp 启动失败")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<QuitFlag>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
