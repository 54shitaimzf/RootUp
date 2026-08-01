use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_WINDOW_LABEL: &str = "main";

/// 确保主窗口存在并可见：
/// - 已存在：显示、还原最小化并聚焦
/// - 不存在：按统一配置重建（关闭即销毁策略的恢复入口）
pub fn ensure_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    } else {
        WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("RootUp")
            .inner_size(1024.0, 680.0)
            .min_inner_size(880.0, 560.0)
            .center()
            .build()?;
    }
    Ok(())
}

/// 销毁主窗口，让应用回到纯托盘后台（释放 WebView 内存）。
pub fn destroy_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.destroy()?;
    }
    Ok(())
}
