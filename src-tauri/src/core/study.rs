//! 学业数据模型、校验与种子数据：学期即课表，课程携带稳定 `course-<id>` 标签键。
use crate::core::labels::valid_key;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const STUDY_VERSION: u32 = 1;
pub const WEEK_MIN: u32 = 1;
pub const WEEK_MAX: u32 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Semester {
    pub id: String,
    pub name: String,
    pub start_date: String,
    #[serde(default)]
    pub end_date: Option<String>,
    pub week_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub name: String,
    pub teacher: String,
    pub location: String,
    pub day: u8,
    pub start_min: u32,
    pub end_min: u32,
    pub week_rule: String,
    #[serde(default)]
    pub week_range: Option<String>,
    pub color: String,
    #[serde(default)]
    pub label_key: String,
    /// 课程别名（0.8.7 阶段二）：项目名/路径按课程名或别名匹配；旧数据自动兼容为空。
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Homework {
    pub id: String,
    #[serde(default)]
    pub course_id: Option<String>,
    pub title: String,
    pub note: String,
    pub details: String,
    pub due_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyData {
    #[serde(default)]
    pub version: u32,
    pub semesters: Vec<Semester>,
    #[serde(default)]
    pub courses_by_semester: HashMap<String, Vec<Course>>,
    #[serde(default)]
    pub homework_by_semester: HashMap<String, Vec<Homework>>,
}

/// 解析周次范围（如 "2-16"、"1,3,5-8"），非法返回 None。
pub fn parse_week_range(range: &str) -> Option<HashSet<u32>> {
    let mut weeks = HashSet::new();
    for part in range.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return None;
        }
        let nums: Vec<u32> = part
            .split('-')
            .map(|s| s.trim().parse::<u32>().ok())
            .collect::<Option<Vec<_>>>()?;
        let (a, b) = match nums.as_slice() {
            [a] => (*a, *a),
            [a, b] if b >= a => (*a, *b),
            _ => return None,
        };
        if a < WEEK_MIN || b > WEEK_MAX {
            return None;
        }
        for week in a..=b {
            weeks.insert(week);
        }
    }
    Some(weeks)
}

/// 两门课程是否会在同一周上课（周次有交集）。
pub fn weeks_overlap(
    rule_a: &str,
    range_a: Option<&str>,
    rule_b: &str,
    range_b: Option<&str>,
) -> bool {
    let set = |rule: &str, range: Option<&str>| -> HashSet<u32> {
        match rule {
            "odd" => (WEEK_MIN..=WEEK_MAX).filter(|w| w % 2 == 1).collect(),
            "even" => (WEEK_MIN..=WEEK_MAX).filter(|w| w % 2 == 0).collect(),
            "range" => range.and_then(parse_week_range).unwrap_or_default(),
            _ => (WEEK_MIN..=WEEK_MAX).collect(),
        }
    };
    let a = set(rule_a, range_a);
    let b = set(rule_b, range_b);
    a.iter().any(|week| b.contains(week))
}

fn valid_week_rule(rule: &str) -> bool {
    matches!(rule, "all" | "odd" | "even" | "range")
}

fn valid_name_len(value: &str, max: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= max
}

/// 课程 id → 稳定标签键：`course-` + 清洗后的 id，总长 ≤32。
pub fn course_label_key(id: &str) -> String {
    let cleaned: String = id
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
        .collect();
    let base = if cleaned.is_empty() {
        "course-c".to_string()
    } else {
        format!("course-{cleaned}")
    };
    base.chars().take(32).collect()
}

fn unique_label_key(base: &str, used: &HashSet<String>) -> String {
    if !used.contains(base) {
        return base.to_string();
    }
    for index in 2..=99 {
        let suffix = format!("-{index}");
        let head = &base[..base.len().saturating_sub(suffix.len())];
        let candidate = format!("{head}{suffix}");
        let candidate: String = candidate.chars().take(32).collect();
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    let mut hash = 0u64;
    for b in base.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as u64);
    }
    format!("course-{:016x}", hash % u64::MAX)
}

/// 为缺失/非法 label_key 的课程生成稳定键，并保证全局唯一。
pub fn ensure_label_keys(data: &mut StudyData) {
    let mut used: HashSet<String> = HashSet::new();
    for courses in data.courses_by_semester.values_mut() {
        for course in courses.iter_mut() {
            if !valid_key(&course.label_key) {
                course.label_key = unique_label_key(&course_label_key(&course.id), &used);
            } else if used.contains(&course.label_key) {
                course.label_key = unique_label_key(&course.label_key, &used);
            }
            used.insert(course.label_key.clone());
        }
    }
}

/// 学业数据校验：结构、字段、周次冲突、标签键唯一性。
pub fn validate_study_data(data: &StudyData) -> Result<(), String> {
    let mut semester_ids = HashSet::new();
    let mut semester_names = HashSet::new();
    let mut label_keys = HashSet::new();

    for semester in &data.semesters {
        if semester.id.is_empty() || semester_ids.contains(&semester.id) {
            return Err("学期 id 为空或重复".into());
        }
        semester_ids.insert(semester.id.clone());
        if !valid_name_len(&semester.name, 40) {
            return Err(format!("学期名称无效: {}", semester.name));
        }
        let name_lower = semester.name.trim().to_lowercase();
        if !semester_names.insert(name_lower) {
            return Err(format!("学期名称重复: {}", semester.name));
        }
        if semester.start_date.is_empty() {
            return Err("学期开始日期为空".into());
        }
        if let Some(end) = &semester.end_date {
            if end < &semester.start_date {
                return Err("学期结束日期早于开始日期".into());
            }
        }
        if semester.week_count < WEEK_MIN || semester.week_count > WEEK_MAX {
            return Err("学期周数需在 1–30".into());
        }

        let courses = data.courses_by_semester.get(&semester.id);
        let mut course_ids = HashSet::new();
        if let Some(courses) = courses {
            for course in courses {
                if course.id.is_empty() || !course_ids.insert(course.id.clone()) {
                    return Err("课程 id 为空或重复".into());
                }
                if !valid_name_len(&course.name, 40) {
                    return Err("课程名称无效".into());
                }
                if course.teacher.trim().chars().count() > 40
                    || course.location.trim().chars().count() > 40
                {
                    return Err("老师/地点过长".into());
                }
                if !(1..=7).contains(&course.day) {
                    return Err("课程星期需在 1–7".into());
                }
                if course.end_min <= course.start_min || course.end_min > 24 * 60 {
                    return Err("课程时间无效".into());
                }
                if !valid_week_rule(&course.week_rule) {
                    return Err("课程周次规则无效".into());
                }
                if course.week_rule == "range"
                    && course
                        .week_range
                        .as_deref()
                        .and_then(parse_week_range)
                        .is_none()
                {
                    return Err("指定周次格式无效".into());
                }
                if !valid_key(&course.label_key) {
                    return Err("课程标签键无效".into());
                }
                if !label_keys.insert(course.label_key.clone()) {
                    return Err("课程标签键重复".into());
                }
            }
            for i in 0..courses.len() {
                for j in (i + 1)..courses.len() {
                    let a = &courses[i];
                    let b = &courses[j];
                    if a.day == b.day
                        && a.start_min < b.end_min
                        && b.start_min < a.end_min
                        && weeks_overlap(
                            &a.week_rule,
                            a.week_range.as_deref(),
                            &b.week_rule,
                            b.week_range.as_deref(),
                        )
                    {
                        return Err(format!("同周冲突: {} 与 {}", a.name, b.name));
                    }
                }
            }
        }

        let course_ids: HashSet<&str> = courses
            .map(|list| list.iter().map(|c| c.id.as_str()).collect())
            .unwrap_or_default();
        if let Some(homework) = data.homework_by_semester.get(&semester.id) {
            let mut homework_ids = HashSet::new();
            for item in homework {
                if item.id.is_empty() || !homework_ids.insert(item.id.clone()) {
                    return Err("作业 id 为空或重复".into());
                }
                if !valid_name_len(&item.title, 60) {
                    return Err("作业标题无效".into());
                }
                if item.note.chars().count() > 200 || item.details.chars().count() > 5000 {
                    return Err("作业备注/详情过长".into());
                }
                if item.due_at.is_empty() {
                    return Err("作业截止时间为空".into());
                }
                if !matches!(item.status.as_str(), "pending" | "done" | "archived") {
                    return Err("作业状态无效".into());
                }
                if let Some(course_id) = &item.course_id {
                    if !course_ids.contains(course_id.as_str()) {
                        return Err("作业引用了不存在的课程".into());
                    }
                }
            }
        }
    }
    Ok(())
}

fn date_string(days_from_today: i64) -> String {
    let today = Local::now().date_naive();
    let date = today + chrono::Duration::days(days_from_today);
    format!("{}T23:59:00", date.format("%Y-%m-%d"))
}

/// 场景与边界学期数据（含短课时、周末课、三张堆叠、长标题与各作业状态）。
pub fn scenario_semester() -> Semester {
    Semester {
        id: "fall-2026".into(),
        name: "2026 秋季学期".into(),
        start_date: "2026-08-03".into(),
        end_date: Some("2026-12-20".into()),
        week_count: 20,
    }
}

pub fn scenario_courses() -> Vec<Course> {
    vec![
        Course {
            id: "c-demo-1".into(),
            name: "高等数学".into(),
            teacher: "王老师".into(),
            location: "教 101".into(),
            day: 1,
            start_min: 480,
            end_min: 580,
            week_rule: "all".into(),
            week_range: None,
            color: "sky".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-2".into(),
            name: "程序设计".into(),
            teacher: "李老师".into(),
            location: "机房 A".into(),
            day: 3,
            start_min: 600,
            end_min: 700,
            week_rule: "odd".into(),
            week_range: None,
            color: "violet".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-3".into(),
            name: "线性代数".into(),
            teacher: "张老师".into(),
            location: "教 202".into(),
            day: 4,
            start_min: 840,
            end_min: 940,
            week_rule: "even".into(),
            week_range: None,
            color: "emerald".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-4".into(),
            name: "大学物理".into(),
            teacher: "赵老师".into(),
            location: "理科楼 301".into(),
            day: 3,
            start_min: 600,
            end_min: 700,
            week_rule: "even".into(),
            week_range: None,
            color: "cyan".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-5".into(),
            name: "数据结构与算法分析（含实验）——面向工程实践的综合课程设计".into(),
            teacher: "李教授".into(),
            location: "工科楼 508（实验机房 / 计算中心）".into(),
            day: 2,
            start_min: 600,
            end_min: 700,
            week_rule: "all".into(),
            week_range: None,
            color: "amber".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-6".into(),
            name: "晨读英语".into(),
            teacher: "陈老师".into(),
            location: "外语楼 101".into(),
            day: 2,
            start_min: 450,
            end_min: 480,
            week_rule: "all".into(),
            week_range: None,
            color: "rose".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-7".into(),
            name: "体育俱乐部".into(),
            teacher: "刘教练".into(),
            location: "体育馆".into(),
            day: 6,
            start_min: 540,
            end_min: 600,
            week_rule: "all".into(),
            week_range: None,
            color: "lime".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-8".into(),
            name: "研讨课 A".into(),
            teacher: "周老师".into(),
            location: "研讨室 1".into(),
            day: 5,
            start_min: 480,
            end_min: 540,
            week_rule: "range".into(),
            week_range: Some("1-2".into()),
            color: "slate".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-9".into(),
            name: "研讨课 B".into(),
            teacher: "吴老师".into(),
            location: "研讨室 2".into(),
            day: 5,
            start_min: 480,
            end_min: 540,
            week_rule: "range".into(),
            week_range: Some("3-4".into()),
            color: "blue".into(),
            label_key: String::new(),
            aliases: vec![],
        },
        Course {
            id: "c-demo-10".into(),
            name: "研讨课 C".into(),
            teacher: "郑老师".into(),
            location: "研讨室 3".into(),
            day: 5,
            start_min: 480,
            end_min: 540,
            week_rule: "range".into(),
            week_range: Some("5-6".into()),
            color: "teal".into(),
            label_key: String::new(),
            aliases: vec![],
        },
    ]
}

pub fn scenario_homework() -> Vec<Homework> {
    vec![
        Homework {
            id: "h-demo-1".into(),
            course_id: Some("c-demo-1".into()),
            title: "高等数学 作业 3".into(),
            note: "第 3 章习题 1–8，周二前交".into(),
            details: "完成第 3 章习题 1–8，重点：极限与连续。\n要求写出完整推导过程，拍照或扫描后提交到课程平台。".into(),
            due_at: date_string(-2),
            status: "pending".into(),
        },
        Homework {
            id: "h-demo-2".into(),
            course_id: Some("c-demo-2".into()),
            title: "程序设计 实验报告".into(),
            note: "提交到课程平台".into(),
            details: String::new(),
            due_at: date_string(0),
            status: "pending".into(),
        },
        Homework {
            id: "h-demo-3".into(),
            course_id: Some("c-demo-4".into()),
            title: "大学物理 预习笔记".into(),
            note: String::new(),
            details: String::new(),
            due_at: date_string(1),
            status: "pending".into(),
        },
        Homework {
            id: "h-demo-4".into(),
            course_id: None,
            title: "自学笔记整理".into(),
            note: String::new(),
            details: String::new(),
            due_at: date_string(3),
            status: "pending".into(),
        },
        Homework {
            id: "h-demo-5".into(),
            course_id: Some("c-demo-3".into()),
            title: "线性代数 习题 2".into(),
            note: String::new(),
            details: String::new(),
            due_at: "2026-08-01T23:59:00".into(),
            status: "done".into(),
        },
        Homework {
            id: "h-demo-6".into(),
            course_id: Some("c-demo-5".into()),
            title: "数据结构 结课报告".into(),
            note: String::new(),
            details: String::new(),
            due_at: "2026-07-20T23:59:00".into(),
            status: "archived".into(),
        },
    ]
}

/// 默认种子数据：场景学期 + 空的新学期。
pub fn seed_study_data() -> StudyData {
    let mut data = StudyData {
        version: STUDY_VERSION,
        semesters: vec![scenario_semester()],
        courses_by_semester: HashMap::new(),
        homework_by_semester: HashMap::new(),
    };
    data.courses_by_semester
        .insert("fall-2026".into(), scenario_courses());
    data.homework_by_semester
        .insert("fall-2026".into(), scenario_homework());
    data.semesters.push(Semester {
        id: "spring-2027".into(),
        name: "2027 春季学期".into(),
        start_date: "2027-03-01".into(),
        end_date: Some("2027-07-18".into()),
        week_count: 20,
    });
    data.courses_by_semester
        .insert("spring-2027".into(), Vec::new());
    data.homework_by_semester
        .insert("spring-2027".into(), Vec::new());
    ensure_label_keys(&mut data);
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_is_valid() {
        let data = seed_study_data();
        assert!(validate_study_data(&data).is_ok());
        assert_eq!(data.semesters.len(), 2);
        assert_eq!(data.courses_by_semester["fall-2026"].len(), 10);
        assert_eq!(data.homework_by_semester["fall-2026"].len(), 6);
    }

    #[test]
    fn label_keys_are_stable_and_unique() {
        let mut data = seed_study_data();
        let first = data.courses_by_semester["fall-2026"][0].label_key.clone();
        ensure_label_keys(&mut data);
        assert_eq!(data.courses_by_semester["fall-2026"][0].label_key, first);
        let mut keys = HashSet::new();
        for courses in data.courses_by_semester.values() {
            for course in courses {
                assert!(valid_key(&course.label_key));
                assert!(keys.insert(course.label_key.clone()));
            }
        }
    }

    #[test]
    fn label_key_from_id() {
        assert_eq!(course_label_key("c-demo-1"), "course-c-demo-1");
        assert_eq!(course_label_key("ABC_1"), "course-abc1");
        assert!(valid_key(&course_label_key(&"a".repeat(40))));
    }

    #[test]
    fn weeks_overlap_matrix() {
        assert!(weeks_overlap("all", None, "odd", None));
        assert!(!weeks_overlap("odd", None, "even", None));
        assert!(weeks_overlap("range", Some("2-4"), "range", Some("3-5")));
        assert!(!weeks_overlap("range", Some("2-4"), "range", Some("5-8")));
        assert!(weeks_overlap("odd", None, "odd", None));
    }

    #[test]
    fn week_rules_match_fixture() {
        let raw = include_str!("../../../fixtures/study-week-cases.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("fixtures/study-week-cases.json 应可解析");
        for case in value["parseCases"].as_array().expect("parseCases 应为数组") {
            let range = case["range"].as_str().unwrap();
            let valid = case["valid"].as_bool().unwrap();
            let parsed = parse_week_range(range);
            assert_eq!(
                parsed.is_some(),
                valid,
                "range={range:?} 有效性应与契约一致"
            );
            if let Some(weeks) = parsed {
                let mut actual: Vec<u32> = weeks.into_iter().collect();
                actual.sort_unstable();
                let expected: Vec<u32> = case["weeks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_u64().unwrap() as u32)
                    .collect();
                assert_eq!(actual, expected, "range={range:?} 周次集合应与契约一致");
            }
        }
        for case in value["overlapCases"]
            .as_array()
            .expect("overlapCases 应为数组")
        {
            let opt = |v: &serde_json::Value| v.as_str().map(|s| s.to_string());
            let overlap = weeks_overlap(
                case["ruleA"].as_str().unwrap(),
                opt(&case["rangeA"]).as_deref(),
                case["ruleB"].as_str().unwrap(),
                opt(&case["rangeB"]).as_deref(),
            );
            assert_eq!(
                overlap,
                case["overlap"].as_bool().unwrap(),
                "overlap 用例与契约不符"
            );
        }
    }

    #[test]
    fn conflict_detected_in_validation() {
        let mut data = seed_study_data();
        let courses = data.courses_by_semester.get_mut("fall-2026").unwrap();
        courses.push(Course {
            id: "bad".into(),
            name: "冲突课".into(),
            teacher: String::new(),
            location: String::new(),
            day: 1,
            start_min: 500,
            end_min: 560,
            week_rule: "all".into(),
            week_range: None,
            color: "slate".into(),
            label_key: String::new(),
            aliases: vec![],
        });
        ensure_label_keys(&mut data);
        assert!(validate_study_data(&data).is_err());
    }

    #[test]
    fn homework_reference_checked() {
        let mut data = seed_study_data();
        let homework = data.homework_by_semester.get_mut("fall-2026").unwrap();
        homework[0].course_id = Some("missing".into());
        assert!(validate_study_data(&data).is_err());
    }
}
