//! 作业截止提醒判定（纯逻辑）：前端学业页与托盘菜单共用同一规则。
use crate::core::study::StudyData;
use chrono::{NaiveDate, NaiveDateTime};

/// 托盘/提示中单次展示的临期+逾期作业上限。
pub const REMINDER_MAX_ITEMS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReminderKind {
    Overdue,
    DueSoon,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderItem {
    pub semester_id: String,
    pub homework_id: String,
    pub title: String,
    pub due_at: String,
    pub kind: ReminderKind,
}

/// 解析 `YYYY-MM-DDTHH:mm:ss`（兼容纯日期）。
pub fn parse_due_date(due_at: &str) -> Option<NaiveDate> {
    NaiveDateTime::parse_from_str(due_at, "%Y-%m-%dT%H:%M:%S")
        .map(|dt| dt.date())
        .ok()
        .or_else(|| NaiveDate::parse_from_str(due_at, "%Y-%m-%d").ok())
}

/// 距截止的自然日差（与前端 `calendarDaysUntil` 一致：按日期差、不足一天计 0）。
pub fn days_until_due(due_at: &str, today: NaiveDate) -> Option<i64> {
    Some(
        parse_due_date(due_at)?
            .signed_duration_since(today)
            .num_days(),
    )
}

/// 判定提醒类别：逾期优先；临期 = 0..=lead_days；其余无提醒。
pub fn reminder_kind(days: i64, lead_days: u32) -> Option<ReminderKind> {
    if days < 0 {
        Some(ReminderKind::Overdue)
    } else if days <= lead_days as i64 {
        Some(ReminderKind::DueSoon)
    } else {
        None
    }
}

/// 汇总提醒作业（仅待办；逾期优先，组内按截止升序；上限 max）。
pub fn reminder_items(
    data: &StudyData,
    enabled: bool,
    lead_days: u32,
    today: NaiveDate,
    max: usize,
) -> Vec<ReminderItem> {
    if !enabled || max == 0 {
        return Vec::new();
    }
    let mut items: Vec<ReminderItem> = Vec::new();
    for (semester_id, homework) in &data.homework_by_semester {
        for item in homework {
            if item.status != "pending" {
                continue;
            }
            let Some(days) = days_until_due(&item.due_at, today) else {
                continue;
            };
            let Some(kind) = reminder_kind(days, lead_days) else {
                continue;
            };
            items.push(ReminderItem {
                semester_id: semester_id.clone(),
                homework_id: item.id.clone(),
                title: item.title.clone(),
                due_at: item.due_at.clone(),
                kind,
            });
        }
    }
    let rank = |kind: ReminderKind| {
        if kind == ReminderKind::Overdue {
            0
        } else {
            1
        }
    };
    items.sort_by(|a, b| {
        rank(a.kind)
            .cmp(&rank(b.kind))
            .then_with(|| a.due_at.cmp(&b.due_at))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.homework_id.cmp(&b.homework_id))
    });
    items.truncate(max);
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::study::{seed_study_data, Homework};
    use serde::Deserialize;
    use std::collections::HashMap;

    #[derive(Deserialize)]
    struct ReminderFixture {
        days_until_due: Vec<DaysCase>,
        reminder_kind: Vec<KindCase>,
        group_cases: Vec<GroupCase>,
        reminder_items: Vec<ItemsCase>,
    }

    #[derive(Deserialize)]
    struct DaysCase {
        due_at: String,
        today: String,
        expected: i64,
    }

    #[derive(Deserialize)]
    struct KindCase {
        days: i64,
        lead_days: u32,
        expected: String,
    }

    #[derive(Deserialize)]
    struct GroupCase {
        name: String,
        lead_days: u32,
        today: String,
        homework: Vec<Homework>,
        expected: HashMap<String, String>,
    }

    #[derive(Deserialize)]
    struct ItemsCase {
        name: String,
        enabled: bool,
        lead_days: u32,
        today: String,
        max: usize,
        homework: Vec<Homework>,
        expected_ids: Vec<String>,
    }

    fn load_fixture() -> ReminderFixture {
        let raw = include_str!("../../../fixtures/reminder-cases.json");
        serde_json::from_str(raw).expect("fixtures/reminder-cases.json 应可解析")
    }

    fn parse_date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    const TODAY: &str = "2026-08-06";

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    fn hw(id: &str, due_at: &str, status: &str) -> Homework {
        Homework {
            id: id.to_string(),
            course_id: None,
            title: format!("作业 {id}"),
            note: String::new(),
            details: String::new(),
            due_at: due_at.to_string(),
            status: status.to_string(),
        }
    }

    #[test]
    fn days_until_due_boundaries() {
        assert_eq!(days_until_due("2026-08-06T23:59:00", date(TODAY)), Some(0));
        assert_eq!(days_until_due("2026-08-07T00:00:00", date(TODAY)), Some(1));
        assert_eq!(days_until_due("2026-08-05T23:59:00", date(TODAY)), Some(-1));
        assert_eq!(days_until_due("2026-08-06", date(TODAY)), Some(0));
        assert_eq!(days_until_due("不是日期", date(TODAY)), None);
    }

    #[test]
    fn reminder_kind_matrix() {
        assert_eq!(reminder_kind(-5, 3), Some(ReminderKind::Overdue));
        assert_eq!(reminder_kind(-1, 3), Some(ReminderKind::Overdue));
        assert_eq!(reminder_kind(0, 3), Some(ReminderKind::DueSoon));
        assert_eq!(reminder_kind(3, 3), Some(ReminderKind::DueSoon));
        assert_eq!(reminder_kind(4, 3), None);
        assert_eq!(reminder_kind(14, 14), Some(ReminderKind::DueSoon));
    }

    #[test]
    fn reminder_items_filters_and_orders() {
        let mut data = seed_study_data();
        data.homework_by_semester.insert(
            "fall-2026".into(),
            vec![
                hw("h1", "2026-08-10T23:59:00", "pending"), // +4 → 不提醒
                hw("h2", "2026-08-09T23:59:00", "pending"), // +3 → 临期
                hw("h3", "2026-08-06T23:59:00", "pending"), // 当天 → 临期
                hw("h4", "2026-08-04T23:59:00", "pending"), // 逾期
                hw("h5", "2026-08-09T23:59:00", "done"),    // 已完成不算
                hw("h6", "2026-08-04T23:59:00", "archived"),
            ],
        );

        let items = reminder_items(&data, true, 3, date(TODAY), 10);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].kind, ReminderKind::Overdue);
        assert_eq!(items[0].homework_id, "h4");
        assert_eq!(items[1].kind, ReminderKind::DueSoon);
        assert_eq!(items[1].homework_id, "h3");
        assert_eq!(items[2].homework_id, "h2");

        assert!(reminder_items(&data, false, 3, date(TODAY), 10).is_empty());
    }

    #[test]
    fn reminder_items_respects_max_and_empty_data() {
        let mut data = seed_study_data();
        let mut list = Vec::new();
        for i in 0..12 {
            list.push(hw(&format!("h{i}"), "2026-08-07T23:59:00", "pending"));
        }
        data.homework_by_semester.insert("fall-2026".into(), list);
        let items = reminder_items(&data, true, 3, date(TODAY), REMINDER_MAX_ITEMS);
        assert_eq!(items.len(), REMINDER_MAX_ITEMS);

        let empty = StudyData::default();
        assert!(reminder_items(&empty, true, 3, date(TODAY), 10).is_empty());
    }

    #[test]
    fn fixture_days_until_due() {
        let fixture = load_fixture();
        for case in fixture.days_until_due {
            assert_eq!(
                days_until_due(&case.due_at, parse_date(&case.today)),
                Some(case.expected),
                "due_at={} today={}",
                case.due_at,
                case.today
            );
        }
    }

    #[test]
    fn fixture_reminder_kind() {
        let fixture = load_fixture();
        for case in fixture.reminder_kind {
            let expected = match case.expected.as_str() {
                "overdue" => Some(ReminderKind::Overdue),
                "dueSoon" => Some(ReminderKind::DueSoon),
                "none" => None,
                other => panic!("未知期望值: {other}"),
            };
            assert_eq!(
                reminder_kind(case.days, case.lead_days),
                expected,
                "days={} lead_days={}",
                case.days,
                case.lead_days
            );
        }
    }

    #[test]
    fn fixture_group_cases() {
        let fixture = load_fixture();
        for case in fixture.group_cases {
            let today = parse_date(&case.today);
            for hw in &case.homework {
                let days = days_until_due(&hw.due_at, today).expect("日期应可解析");
                let actual = if hw.status != "pending" {
                    "normal"
                } else {
                    match reminder_kind(days, case.lead_days) {
                        Some(ReminderKind::Overdue) => "overdue",
                        Some(ReminderKind::DueSoon) => "dueSoon",
                        None => "normal",
                    }
                };
                let expected = case
                    .expected
                    .get(&hw.id)
                    .map(String::as_str)
                    .unwrap_or_else(|| panic!("fixture 缺少 {}/{}", case.name, hw.id));
                assert_eq!(actual, expected, "case={} id={}", case.name, hw.id);
            }
        }
    }

    #[test]
    fn fixture_reminder_items() {
        let fixture = load_fixture();
        for case in fixture.reminder_items {
            let today = parse_date(&case.today);
            let mut data = StudyData::default();
            data.homework_by_semester
                .insert("fixture".into(), case.homework);
            let items = reminder_items(&data, case.enabled, case.lead_days, today, case.max);
            let ids: Vec<String> = items.iter().map(|i| i.homework_id.clone()).collect();
            assert_eq!(ids, case.expected_ids, "case={}", case.name);
        }
    }
}
