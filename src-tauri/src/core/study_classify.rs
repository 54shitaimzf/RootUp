//! 课程分类器：文件名/路径包含完整课程名时输出 `course-<key>` 标签。
use crate::core::classify::{Classifier, ClassifyInput};
use crate::core::index::IndexStore;
use crate::core::study::StudyData;
use std::sync::{Arc, Mutex};

/// 名称(小写) → 课程标签键，按名称长度从长到短排序（长名优先）。
#[derive(Debug, Clone, Default)]
pub struct StudyClassifier {
    matchers: Vec<(String, String)>,
}

impl StudyClassifier {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn refresh(&mut self, data: &StudyData) {
        let mut matchers: Vec<(String, String)> = Vec::new();
        for courses in data.courses_by_semester.values() {
            for course in courses {
                let name = course.name.trim();
                if name.chars().count() < 2 || course.label_key.is_empty() {
                    continue;
                }
                if matchers.iter().any(|(_, key)| key == &course.label_key) {
                    continue;
                }
                matchers.push((name.to_lowercase(), course.label_key.clone()));
            }
        }
        matchers.sort_by(|a, b| {
            b.0.chars()
                .count()
                .cmp(&a.0.chars().count())
                .then_with(|| a.0.cmp(&b.0))
        });
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
        let mut out = Vec::new();
        for (name, key) in &self.matchers {
            if haystack.contains(name) && !out.contains(key) {
                out.push(key.clone());
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
