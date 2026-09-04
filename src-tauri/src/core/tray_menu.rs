//! 托盘菜单模型（纯函数）：输入学业数据与设置，输出动态菜单所需的信息。
use crate::core::reminder::{reminder_items, ReminderItem, REMINDER_MAX_ITEMS};
use crate::core::settings::Settings;
use crate::core::study::StudyData;
use chrono::NaiveDate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayMenuModel {
    /// 临期+逾期作业总数（tooltip 展示）。
    pub due_count: usize,
    /// 排序后的提醒作业（逾期优先，上限 8）。
    pub items: Vec<ReminderItem>,
    /// 自动归档开关当前态（菜单勾选）。
    pub auto_archive: bool,
    /// 主题当前态（system/light/dark）。
    pub theme: String,
}

pub fn tray_menu_model(data: &StudyData, settings: &Settings, today: NaiveDate) -> TrayMenuModel {
    let items = reminder_items(
        data,
        settings.reminder_enabled,
        settings.reminder_lead_days,
        today,
        REMINDER_MAX_ITEMS,
    );
    TrayMenuModel {
        due_count: items.len(),
        items,
        auto_archive: settings.auto_archive,
        theme: settings.theme.clone(),
    }
}

/// 托盘图标是否切换为红点角标版：有临期/逾期待办时显示。
pub fn tray_icon_has_badge(due_count: usize) -> bool {
    due_count > 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::study::seed_study_data;
    use chrono::{Local, NaiveDate};

    fn settings() -> Settings {
        Settings {
            reminder_enabled: true,
            reminder_lead_days: 3,
            auto_archive: true,
            theme: "dark".into(),
            ..Default::default()
        }
    }

    #[test]
    fn model_reflects_settings_and_data() {
        let data = seed_study_data();
        // 种子作业的截止日期按运行日相对生成（如今天-2），判断基准须一致，避免日期漂移导致脆弱。
        let today = Local::now().date_naive();
        let model = tray_menu_model(&data, &settings(), today);
        assert!(model.due_count <= REMINDER_MAX_ITEMS);
        assert!(model.auto_archive);
        assert_eq!(model.theme, "dark");
        // 种子数据含逾期待办（h-demo-1），提醒开启时应至少 1 项
        assert!(model.due_count >= 1);
        assert!(model
            .items
            .iter()
            .any(|item| item.homework_id == "h-demo-1"));
    }

    #[test]
    fn model_empty_when_disabled() {
        let data = seed_study_data();
        let today = NaiveDate::parse_from_str("2026-08-06", "%Y-%m-%d").unwrap();
        let mut s = settings();
        s.reminder_enabled = false;
        let model = tray_menu_model(&data, &s, today);
        assert_eq!(model.due_count, 0);
        assert!(model.items.is_empty());
    }

    #[test]
    fn tray_icon_has_badge_boundaries() {
        assert!(!tray_icon_has_badge(0));
        assert!(tray_icon_has_badge(1));
        assert!(tray_icon_has_badge(8));
    }
}
