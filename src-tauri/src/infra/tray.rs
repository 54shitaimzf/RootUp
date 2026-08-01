use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::App;

pub fn init(app: &App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "打开", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!(
        "../../../resources/icons/RootUp_64x64.png"
    ))?;

    let _tray = TrayIconBuilder::with_id("rootup-tray")
        .icon(icon)
        .tooltip("RootUp")
        .menu(&menu)
        .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
            match event.id().as_ref() {
                "open" => {
                    let _ = crate::infra::window::ensure_main_window(app);
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
