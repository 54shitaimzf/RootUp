//! 课程分类器：文件名/路径包含完整课程名时输出 `course-<key>` 标签。
use crate::core::classify::{Classifier, ClassifyInput};
use crate::core::index::IndexStore;
use crate::core::study::StudyData;
use aho_corasick::AhoCorasick;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

/// 名称(小写) → 课程标签键，按名称长度从长到短排序（长名优先）。
#[derive(Debug, Clone, Default)]
pub struct StudyClassifier {
    matchers: Vec<(String, String)>,
    /// 课程名的 Aho-Corasick 自动机（一次多模式匹配，替代逐课程 contains）
    ac: Option<AhoCorasick>,
}

impl StudyClassifier {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn refresh(&mut self, data: &StudyData) {
        let semester_order: HashMap<&str, usize> = data
            .semesters
            .iter()
            .enumerate()
            .map(|(idx, sem)| (sem.id.as_str(), idx))
            .collect();
        let mut candidates: Vec<(usize, String, String, String)> = Vec::new();
        for (sem_id, courses) in &data.courses_by_semester {
            let sem_idx = semester_order
                .get(sem_id.as_str())
                .copied()
                .unwrap_or(usize::MAX);
            for course in courses {
                let name = course.name.trim();
                if name.chars().count() < 2 || course.label_key.is_empty() {
                    continue;
                }
                candidates.push((
                    sem_idx,
                    course.id.clone(),
                    name.to_lowercase(),
                    course.label_key.clone(),
                ));
            }
        }
        // 重名课程（不同学期/时间的同一门课）只保留第一个稳定 key
        candidates.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let mut by_name: BTreeMap<String, String> = BTreeMap::new();
        for (_, _, name, key) in candidates {
            by_name.entry(name).or_insert(key);
        }
        let mut matchers: Vec<(String, String)> = by_name.into_iter().collect();
        matchers.sort_by(|a, b| {
            b.0.chars()
                .count()
                .cmp(&a.0.chars().count())
                .then_with(|| a.0.cmp(&b.0))
        });
        let names: Vec<String> = matchers.iter().map(|(name, _)| name.clone()).collect();
        self.ac = if names.is_empty() {
            None
        } else {
            Some(
                AhoCorasick::new(&names)
                    .expect("课程名构建 Aho-Corasick 自动机失败（不应包含空模式）"),
            )
        };
        self.matchers = matchers;
    }

    #[cfg(test)]
    pub fn matcher_count(&self) -> usize {
        self.matchers.len()
    }
}

impl Classifier for StudyClassifier {
    fn id(&self) -> &'static str {
        "study"
    }

    fn labels(&self, input: &ClassifyInput<'_>) -> Vec<String> {
        let haystack = format!(
            "{} {}",
            input.path.to_lowercase(),
            input.name.to_lowercase()
        );
        let Some(ac) = &self.ac else {
            return Vec::new();
        };
        let mut found: Vec<(usize, String)> = Vec::new();
        // 重叠迭代器：原语义是“文件名/路径包含课程名即命中”，
        // 默认模式会跳过被更长命中覆盖的短名，必须用重叠扫描保持等价。
        for matched in ac.find_overlapping_iter(&haystack) {
            let idx = matched.pattern().as_usize();
            found.push((idx, self.matchers[idx].1.clone()));
        }
        // matchers 已按“长名优先”排序，按 pattern 序号排序即恢复原语义
        found.sort_by_key(|(idx, _)| *idx);
        let mut out = Vec::new();
        for (_, key) in found {
            if !out.contains(&key) {
                out.push(key);
            }
        }
        out
    }
}

/// 让分类链共享同一份分类器状态（学业保存后刷新一处即全局生效）。
pub struct SharedStudyClassifier(pub Arc<Mutex<StudyClassifier>>);

impl Classifier for SharedStudyClassifier {
    fn id(&self) -> &'static str {
        "study"
    }

    fn labels(&self, input: &ClassifyInput<'_>) -> Vec<String> {
        self.0
            .lock()
            .map(|classifier| classifier.labels(input))
            .unwrap_or_default()
    }
}

/// 定向重分类：遍历存量记录，用给定分类链重算 labels 并写回（不动 first_seen/modified）。
pub fn reapply_labels(
    store: &mut dyn IndexStore,
    classifier: &dyn Classifier,
) -> Result<i64, String> {
    let records = store.all_records()?;
    let mut changed = 0_i64;
    let mut updates: Vec<(String, String)> = Vec::new();
    for record in &records {
        let input = ClassifyInput {
            name: &record.name,
            file_type: &record.file_type,
            path: &record.path,
            size: record.size as u64,
        };
        let labels = classifier.labels(&input);
        let joined = labels.join(",");
        if joined != record.labels {
            updates.push((record.path.clone(), joined));
            changed += 1;
        }
    }
    store.update_labels_batch(&updates)?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::study::seed_study_data;

    fn input<'a>(path: &'a str) -> ClassifyInput<'a> {
        ClassifyInput {
            name: "",
            file_type: "",
            path,
            size: 1,
        }
    }

    #[test]
    fn matches_course_name_in_path() {
        let classifier = StudyClassifier::new();
        let data = seed_study_data();
        let mut classifier = classifier;
        classifier.refresh(&data);
        let labels = classifier.labels(&input("C:/Courses/高等数学/第1章.pdf"));
        assert_eq!(labels, vec!["course-c-demo-1".to_string()]);
    }

    #[test]
    fn longest_name_wins_and_dedup() {
        let data = seed_study_data();
        let mut classifier = StudyClassifier::new();
        classifier.refresh(&data);
        // 长标题课程唯一命中
        let labels = classifier.labels(&input(
            "C:/x/数据结构与算法分析（含实验）——面向工程实践的综合课程设计.pdf",
        ));
        assert_eq!(labels, vec!["course-c-demo-5".to_string()]);
        // 短名课程命中对应键
        let labels = classifier.labels(&input("C:/x/程序设计报告.pdf"));
        assert_eq!(labels, vec!["course-c-demo-2".to_string()]);
        // 多门课程名同时命中时全部输出（按长名优先排序）
        let labels = classifier.labels(&input("C:/x/高等数学与程序设计.pdf"));
        assert!(labels.contains(&"course-c-demo-1".to_string()));
        assert!(labels.contains(&"course-c-demo-2".to_string()));
    }

    #[test]
    fn aho_corasick_matches_linear_reference() {
        use crate::core::study::{Course, Semester};

        let mut data = seed_study_data();
        let sem = Semester {
            id: "overlap-sem".into(),
            name: "重叠学期".into(),
            start_date: "2099-02-20".into(),
            end_date: None,
            week_count: 20,
        };
        data.semesters.push(sem.clone());
        data.courses_by_semester.insert(
            sem.id.clone(),
            vec![
                Course {
                    id: "c-overlap-1".into(),
                    name: "高等数学".into(),
                    teacher: "李老师".into(),
                    location: "A 楼".into(),
                    day: 1,
                    start_min: 480,
                    end_min: 570,
                    week_rule: "all".into(),
                    week_range: None,
                    color: "blue".into(),
                    label_key: "course-overlap-1".into(),
                },
                Course {
                    id: "c-overlap-2".into(),
                    name: "高等数学（上）".into(),
                    teacher: "王老师".into(),
                    location: "B 楼".into(),
                    day: 3,
                    start_min: 600,
                    end_min: 690,
                    week_rule: "all".into(),
                    week_range: None,
                    color: "green".into(),
                    label_key: "course-overlap-2".into(),
                },
                Course {
                    id: "c-overlap-3".into(),
                    name: "数学".into(),
                    teacher: "赵老师".into(),
                    location: "C 楼".into(),
                    day: 5,
                    start_min: 720,
                    end_min: 810,
                    week_rule: "all".into(),
                    week_range: None,
                    color: "red".into(),
                    label_key: "course-overlap-3".into(),
                },
            ],
        );

        let mut classifier = StudyClassifier::new();
        classifier.refresh(&data);

        let haystacks = [
            "C:/x/高等数学（上）第1章.pdf",
            "C:/x/高等数学.pdf",
            "C:/x/数学分析.pdf",
            "C:/x/大学物理与高等数学.pdf",
            "C:/x/高等数学与数学分析.pdf",
            "C:/x/普通文件.txt",
        ];
        let linear = |haystack: &str| {
            let lower = haystack.to_lowercase();
            let mut out = Vec::new();
            for (name, key) in &classifier.matchers {
                if lower.contains(name) && !out.contains(key) {
                    out.push(key.clone());
                }
            }
            out
        };
        for haystack in haystacks {
            assert_eq!(
                classifier.labels(&input(haystack)),
                linear(haystack),
                "Aho-Corasick 与线性匹配不一致: {haystack}"
            );
        }
    }

    #[test]
    fn same_name_courses_canonicalize_to_one_key() {
        use crate::core::study::{Course, Semester};

        let mut data = seed_study_data();
        let sem = Semester {
            id: "spring-2099".into(),
            name: "2099 春季学期".into(),
            start_date: "2099-02-20".into(),
            end_date: None,
            week_count: 20,
        };
        data.semesters.push(sem.clone());
        data.courses_by_semester.insert(
            sem.id.clone(),
            vec![Course {
                id: "math-dup".into(),
                name: "高等数学".into(),
                teacher: "李老师".into(),
                location: "A 楼".into(),
                day: 2,
                start_min: 600,
                end_min: 700,
                week_rule: "all".into(),
                week_range: None,
                color: "#f59e0b".into(),
                label_key: "course-math-dup".into(),
            }],
        );

        let mut classifier = StudyClassifier::new();
        classifier.refresh(&data);
        let labels = classifier.labels(&input("C:/Courses/高等数学/第1章.pdf"));
        assert_eq!(labels, vec!["course-c-demo-1".to_string()]);
    }

    #[test]
    fn no_match_yields_empty() {
        let data = seed_study_data();
        let mut classifier = StudyClassifier::new();
        classifier.refresh(&data);
        assert!(classifier.labels(&input("C:/x/notes.pdf")).is_empty());
    }

    #[test]
    fn refresh_rebuilds_matchers() {
        let mut classifier = StudyClassifier::new();
        classifier.refresh(&seed_study_data());
        assert!(classifier.matcher_count() >= 10);
    }

    #[test]
    fn reapply_updates_existing_labels_and_preserves_meta() {
        use crate::core::classify::{ClassifierChain, ExtensionClassifier};
        use crate::core::index::FileRecord;
        use crate::infra::index_store::SqliteIndexStore;

        let mut store = SqliteIndexStore::open(":memory:").unwrap();
        let mut math = FileRecord::new("C:/Courses/高等数学/第1章.pdf", 100, 1000, "indexed");
        math.labels = "document".into();
        store.upsert(&math).unwrap();
        let mut song = FileRecord::new("C:/Music/song.mp3", 100, 2000, "indexed");
        song.labels = "audio".into();
        store.upsert(&song).unwrap();

        let mut study = StudyClassifier::new();
        study.refresh(&seed_study_data());
        let mut chain = ClassifierChain::new(vec![
            Box::new(ExtensionClassifier::new()) as Box<dyn Classifier>
        ]);
        chain.push(Box::new(study));

        let changed = reapply_labels(&mut store, &chain).unwrap();
        assert_eq!(changed, 1);

        let got = store
            .get_by_path("C:/Courses/高等数学/第1章.pdf")
            .unwrap()
            .unwrap();
        assert!(got.labels.contains("document"));
        assert!(got.labels.contains("course-c-demo-1"));
        assert_eq!(got.first_seen, 1000);
        assert_eq!(got.modified, 1000);

        let song = store.get_by_path("C:/Music/song.mp3").unwrap().unwrap();
        assert_eq!(song.labels, "audio");
    }
}
