//! 筛选使用习惯：独立于 settings 的应用数据（habits.json）。
//!
//! 习惯是 UI 偏好（排序/补全频率），与用户配置分离；
//! 恢复默认设置不清空习惯，未来可在设置页单独提供“重置使用习惯”。
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 习惯条目数量上限。
pub const MAX_HABIT_ENTRIES: usize = 500;

/// 习惯键最大字符数。
pub const MAX_HABIT_KEY_LEN: usize = 256;

/// 单条目计数上限（防止异常膨胀）。
pub const MAX_HABIT_COUNT: u64 = 1_000_000;

/// 一次使用习惯记录。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Habit {
    pub count: u64,
    pub last_used: u64,
}

/// 习惯表：键（如 `category:document`）→ 使用记录。
pub type FilterHabits = HashMap<String, Habit>;

/// 校验：条目数、键长度、计数与时间戳合法性。
pub fn habits_valid(habits: &FilterHabits) -> bool {
    habits.len() <= MAX_HABIT_ENTRIES
        && habits.iter().all(|(key, habit)| {
            let trimmed = key.trim();
            !trimmed.is_empty()
                && trimmed.chars().count() <= MAX_HABIT_KEY_LEN
                && habit.count >= 1
                && habit.count <= MAX_HABIT_COUNT
                && habit.last_used > 0
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn habit(count: u64, last_used: u64) -> Habit {
        Habit { count, last_used }
    }

    #[test]
    fn empty_is_valid() {
        assert!(habits_valid(&FilterHabits::new()));
    }

    #[test]
    fn valid_entries_pass() {
        let mut habits = FilterHabits::new();
        habits.insert("category:document".into(), habit(3, 1000));
        habits.insert("label:高数".into(), habit(1, 2000));
        assert!(habits_valid(&habits));
    }

    #[test]
    fn invalid_keys_rejected() {
        let mut habits = FilterHabits::new();
        habits.insert("   ".into(), habit(1, 1));
        assert!(!habits_valid(&habits));

        let mut habits = FilterHabits::new();
        habits.insert("长".repeat(MAX_HABIT_KEY_LEN + 1), habit(1, 1));
        assert!(!habits_valid(&habits));
    }

    #[test]
    fn invalid_values_rejected() {
        let mut habits = FilterHabits::new();
        habits.insert("category:document".into(), habit(0, 1));
        assert!(!habits_valid(&habits));

        let mut habits = FilterHabits::new();
        habits.insert("category:document".into(), habit(1, 0));
        assert!(!habits_valid(&habits));

        let mut habits = FilterHabits::new();
        habits.insert("category:document".into(), habit(MAX_HABIT_COUNT + 1, 1));
        assert!(!habits_valid(&habits));
    }

    #[test]
    fn over_capacity_rejected() {
        let habits: FilterHabits = (0..=MAX_HABIT_ENTRIES)
            .map(|i| (format!("key-{i}"), habit(1, 1)))
            .collect();
        assert!(!habits_valid(&habits));
    }

    #[test]
    fn unknown_fields_tolerated_on_load() {
        let json = r#"{"category:document":{"count":3,"last_used":1000,"future":1}}"#;
        let habits: FilterHabits = serde_json::from_str(json).expect("未知字段应被容忍");
        assert_eq!(habits["category:document"].count, 3);
    }
}
