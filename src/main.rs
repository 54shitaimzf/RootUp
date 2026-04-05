// Prevent console window in addition to Slint window in Windows release builds when, e.g., starting the app via file manager. Ignored on other platforms.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use slint::CloseRequestResponse;
use tray_icon::{menu::MenuEvent, TrayIconEvent};
use crate::core::app_tray::tray_init::init_tray_icon;

mod core;

slint::include_modules!();

fn main() -> Result<(), slint::PlatformError> {
    
    //创建应用主窗口，与传入闭包所用的主窗口弱引用
    let main_window = MainWindow::new()?;
    let main_window_weak_for_close = main_window.as_weak();
    let main_window_weak_for_confirm = main_window.as_weak();
    let main_window_weak_for_monitor = main_window.as_weak();

    //将窗口关闭回调关联到闭包，阻止窗口直接关闭
    main_window.window().on_close_requested( move || {
        if let Some(main_window) = main_window_weak_for_close.upgrade() {
            main_window.invoke_show_confirm();
        }
        CloseRequestResponse::KeepWindowShown
    });

    //将确认事件回调关联到闭包，设置应用与窗口状态
    main_window.on_close_confirmed(move |result| {
        if let Some(main_window) = main_window_weak_for_confirm.upgrade() {
            match result {
                Confirmation::DoNotExit => {}
                Confirmation::CloseWithoutExit => {
                    let _ = main_window.hide();
                }
                Confirmation::CloseAndExit => {
                    let _ = slint::quit_event_loop();
                }
            }
        }
    });

    //初始化托盘图标
    init_tray_icon();

    //将slint Timer定时器轮询系统托盘菜单点击回调关联到闭包
    main_window.on_monitor_triggered(move || {

        //内部主窗口引用
        let _main_window = main_window_weak_for_monitor.upgrade().unwrap();
        
        //轮询点击图标事件
        //if let Ok(_event) = TrayIconEvent::receiver().try_recv() {
        //    _main_window.show().unwrap();
        //}

        //轮询点击菜单项事件
        if let Ok(event) = MenuEvent::receiver().try_recv() {
            match event.id.as_ref() {
                "open" => { let _no_warning = _main_window.show(); },
                "quit" => { let _no_warning = slint::quit_event_loop().unwrap(); },
                _ => panic!("未知托盘事件！")
            }
        }
        
    });

    //RootUp，启动！
    main_window.show().unwrap();
    slint::run_event_loop_until_quit()
}
