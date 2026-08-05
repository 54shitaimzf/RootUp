//! 托盘：动态菜单（提醒直达 / 自动归档 / 主题切换 / 退出）与左键唤起。
use crate::app::QuitFlag;
use crate::core::reminder::ReminderKind;
use crate::core::settings::{THEME_DARK, THEME_LIGHT, THEME_SYSTEM};
use crate::core::tray_menu::{tray_menu_model, TrayMenuModel};
use crate::infra::storage;
use crate::infra::study_store::{JsonStudyStore, StudyStore};
use std::sync::atomic::Ordering;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};

const TRAY_ID: &str = "rootup-tray";

struct TrayLabels {
    open: String,
    study: String,
    no_due: String,
    auto_archive: String,
    theme: String,
    theme_system: String,
    theme_light: String,
    theme_dark: String,
    quit: String,
    tooltip_due: String,
}

fn tray_labels(language: &str) -> TrayLabels {
    if language == "en" {
        TrayLabels {
            open: "Open RootUp".into(),
            study: "Study · Open homework".into(),
            no_due: "No homework due soon".into(),
            auto_archive: "Auto-archive new files".into(),
            theme: "Theme".into(),
            theme_system: "Follow system".into(),
            theme_light: "Light".into(),
            theme_dark: "Dark".into(),
            quit: "Quit".into(),
            tooltip_due: "due soon".into(),
        }
    } else {
        TrayLabels {
            open: "打开 RootUp".into(),
            study: "学业 · 打开作业".into(),
            no_due: "暂无临期作业".into(),
            auto_archive: "自动归档新文件".into(),
            theme: "主题".into(),
            theme_system: "跟随系统".into(),
            theme_light: "浅色".into(),
            theme_dark: "深色".into(),
            quit: "退出".into(),
            tooltip_due: "项作业临期".into(),
        }
    }
}

fn build_menu(
    app: &AppHandle,
    model: &TrayMenuModel,
    labels: &TrayLabels,
) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", &labels.open, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;
    let auto_archive = CheckMenuItem::with_id(
        app,
        "auto-archive",
        &labels.auto_archive,
        true,
        model.auto_archive,
        None::<&str>,
    )?;

    let study_items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = if model.items.is_empty() {
        vec![Box::new(MenuItem::with_id(
            app,
            "study-none",
            &labels.no_due,
            false,
            None::<&str>,
        )?)]
    } else {
        model
            .items
            .iter()
            .map(|item| {
                let kind = if item.kind == ReminderKind::Overdue {
                    "逾期"
                } else {
                    "临期"
                };
                let kind_en = if item.kind == ReminderKind::Overdue {
                    "overdue"
                } else {
                    "due"
                };
                let due = item.due_at.get(..10).unwrap_or(&item.due_at);
                let prefix = if labels.open == "Open RootUp" {
                    format!("[{kind_en}] ")
                } else {
                    format!("[{kind}] ")
                };
                Ok(Box::new(MenuItem::with_id(
                    app,
                    format!("study-homework:{}", item.homework_id),
                    format!("{prefix}{} · {due}", item.title),
                    true,
                    None::<&str>,
                )?)
                    as Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>)
            })
            .collect::<tauri::Result<Vec<_>>>()?
    };
    let study_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        study_items.iter().map(|item| item.as_ref()).collect();
    let study = Submenu::with_items(app, &labels.study, true, &study_refs)?;

    let theme_system = CheckMenuItem::with_id(
        app,
        format!("theme:{THEME_SYSTEM}"),
        &labels.theme_system,
        true,
        model.theme == THEME_SYSTEM,
        None::<&str>,
    )?;
    let theme_light = CheckMenuItem::with_id(
        app,
        format!("theme:{THEME_LIGHT}"),
        &labels.theme_light,
        true,
        model.theme == THEME_LIGHT,
        None::<&str>,
    )?;
    let theme_dark = CheckMenuItem::with_id(
        app,
        format!("theme:{THEME_DARK}"),
        &labels.theme_dark,
        true,
        model.theme == THEME_DARK,
        None::<&str>,
    )?;
    let theme_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        vec![&theme_system, &theme_light, &theme_dark];
    let theme = Submenu::with_items(app, &labels.theme, true, &theme_refs)?;

    let items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![
        &open,
        &study,
        &separator,
        &auto_archive,
        &theme,
        &separator,
        &quit,
    ];
    Menu::with_items(app, &items)
}

/// 按当前学业数据与设置重建托盘菜单与 tooltip（保存后调用，不轮询）。
pub fn refresh_tray(app: &AppHandle) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let settings = storage::load_settings(app);
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let study = JsonStudyStore::new(data_dir.join("study.json")).load();
    let today = chrono::Local::now().date_naive();
    let model = tray_menu_model(&study, &settings, today);
    let labels = tray_labels(&settings.language);
    let menu = build_menu(app, &model, &labels).map_err(|e| e.to_string())?;
    let tooltip = if model.due_count > 0 {
        format!("RootUp · {} {}", model.due_count, labels.tooltip_due)
    } else {
        "RootUp".to_string()
    };
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&tooltip))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 初始化托盘：无菜单创建（菜单由 [`refresh_tray`] 立即填充）。
pub fn init(app: &App) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!(
        "../../../resources/icons/rootup-sprout.png"
    ))?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("RootUp")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = crate::infra::window::ensure_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app: &AppHandle, event: tauri::menu::MenuEvent| {
            let id = event.id().as_ref();
            match id {
                "open" => {
                    let _ = crate::infra::window::ensure_main_window(app);
                }
                "quit" => {
                    app.state::<QuitFlag>().0.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                "auto-archive" => {
                    let mut settings = storage::load_settings(app);
                    settings.auto_archive = !settings.auto_archive;
                    if let Err(e) = storage::save_settings(app, &settings) {
                        log::warn!("tray: 切换自动归档失败: {e}");
                    } else {
                        let _ = crate::app::refresh_managed_state(app);
                        let _ = refresh_tray(app);
                    }
                }
                _ if id.starts_with("theme:") => {
                    let theme = id.trim_start_matches("theme:");
                    let mut settings = storage::load_settings(app);
                    settings.theme = theme.to_string();
                    if !settings.is_valid() {
                        log::warn!("tray: 非法主题 {theme}");
                        return;
                    }
                    if let Err(e) = storage::save_settings(app, &settings) {
                        log::warn!("tray: 保存主题失败: {e}");
                    } else {
                        let _ = app.emit("settings-changed", ());
                        let _ = refresh_tray(app);
                    }
                }
                _ if id.starts_with("study-homework:") => {
                    let homework_id = id.trim_start_matches("study-homework:");
                    let _ = crate::infra::window::ensure_main_window(app);
                    let _ = app.emit("study-homework-open", homework_id);
                }
                _ => {}
            }
        })
        .build(app)?;

    if let Err(e) = refresh_tray(app.handle()) {
        log::error!("tray: 初始化菜单失败: {e}");
    }
    Ok(())
}
