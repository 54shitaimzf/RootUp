use crate::core::paths::AppPaths;
use tray_icon::{TrayIconBuilder, menu::MenuItem, menu::Menu, Icon};

pub fn init_tray_icon(){
    
    //通过统一的资源管理路径对象获取icon路径
    let paths = AppPaths::discover();
    let _icon_path = paths.icon("RootUp_64x64.ico");
    let tray_icon = match Icon::from_path(_icon_path, Some((64u32, 64u32))) {
        Ok(icon) => icon,
        Err(_bad_icon) => panic!("未找到应用图标！")
    };

    //创建系统托盘菜单，填入菜单项
    let tray_menu = Menu::new();
    tray_menu.append(&MenuItem::with_id("open", "打开", true, None)).unwrap();
    tray_menu.append(&MenuItem::with_id("quit", "退出", true, None)).unwrap();
    
    //创建系统托盘本体，并关联菜单
    let _rootup_tray = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("RootUp，一款面向学生的文件下载分类管理工具")
        .with_icon(tray_icon)
        .build()
        .unwrap();

    //将所有权转移到堆上，生命周期为整个程序运行时
    Box::leak(Box::new(_rootup_tray));
}

