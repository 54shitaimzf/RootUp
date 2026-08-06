//! 引擎性能基准（自研 harness，无第三方基准依赖）。
//! 运行：`cargo bench --features bench`（release 优化）。
//! 环境变量：ROOTUP_BENCH_VERSION / ROOTUP_BENCH_SAMPLES / ROOTUP_BENCH_OUT / ROOTUP_BENCH_FULL / ROOTUP_BENCH_SMALL。

use rootup_lib::core::classify::{Classifier, ClassifierChain, ExtensionClassifier};
use rootup_lib::core::ignore::IgnoreMatcher;
use rootup_lib::core::index::{FileRecord, IndexStore};
use rootup_lib::core::query::{parse_query, FileQuery};
use rootup_lib::core::scan::{ScanEvent, ScanEventSink, ScanParams, ScanSummary};
use rootup_lib::core::study::seed_study_data;
use rootup_lib::core::study_classify::{reapply_labels, StudyClassifier};
use rootup_lib::infra::archive_engine::{archive_files, undo_file_batch};
use rootup_lib::infra::index_store::SqliteIndexStore;
use rootup_lib::infra::scanner::ScanService;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Sink(Arc<Mutex<Vec<ScanEvent>>>);

impl ScanEventSink for Sink {
    fn on_event(&self, event: ScanEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn env_flag(name: &str) -> bool {
    env::var(name).map(|v| v == "1").unwrap_or(false)
}

fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn summarize(values: &[Duration]) -> (f64, f64, f64, f64) {
    let mut ms: Vec<f64> = values.iter().map(|d| d.as_secs_f64() * 1000.0).collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = ms.len();
    let median = if n == 0 { 0.0 } else { ms[n / 2] };
    let p90 = if n == 0 {
        0.0
    } else {
        let idx = ((n as f64) * 0.9).ceil() as usize;
        ms[idx.min(n - 1)]
    };
    let min = ms.first().copied().unwrap_or(0.0);
    let max = ms.last().copied().unwrap_or(0.0);
    (median, p90, min, max)
}

fn metric(name: &str, unit: &str, values: &[Duration]) -> Value {
    let (median, p90, min, max) = summarize(values);
    json!({
        name: {
            "unit": unit,
            "median": median,
            "p90": p90,
            "min": min,
            "max": max,
            "samples": values.len(),
        }
    })
}

fn wait_scan(events: Arc<Mutex<Vec<ScanEvent>>>, timeout: Duration) -> Result<ScanSummary, String> {
    let deadline = Instant::now() + timeout;
    loop {
        {
            let guard = events.lock().unwrap();
            for event in guard.iter() {
                match event {
                    ScanEvent::Finished { summary } => return Ok(summary.clone()),
                    ScanEvent::Failed { dir, error } => {
                        return Err(format!("scan failed: {dir} {error}"))
                    }
                    _ => {}
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("scan timeout".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn make_scan_fixture(root: &Path, files: usize) {
    let dirs = 100usize.max(1);
    let per = (files / dirs).max(1);
    fs::create_dir_all(root).unwrap();
    for d in 0..dirs {
        let dir = root.join(format!("d{d:03}"));
        fs::create_dir_all(&dir).unwrap();
        for i in 0..per {
            let path = dir.join(format!("f{i:05}.txt"));
            let _ = fs::File::create(path).unwrap();
        }
    }
}

fn bench_scan(dir: &Path, samples: usize, label: &str) -> (Value, Value) {
    let mut durations = Vec::with_capacity(samples);
    let mut rates = Vec::with_capacity(samples);
    for _ in 0..samples {
        let store: Arc<Mutex<dyn IndexStore>> =
            Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
        let sink = Arc::new(Sink(Arc::new(Mutex::new(Vec::new()))));
        let mut service = ScanService::new(
            store,
            Arc::new(ExtensionClassifier::new()),
            IgnoreMatcher::new(),
            ScanParams::default(),
            sink.clone(),
        );
        let start = Instant::now();
        service.enqueue(dir.to_string_lossy().to_string());
        service.start();
        let summary = wait_scan(sink.0.clone(), Duration::from_secs(600)).unwrap();
        durations.push(start.elapsed());
        rates.push(Duration::from_secs_f64(
            1.0 / summary.files_per_sec.max(0.001),
        ));
    }
    (
        metric(&format!("engine_scan_{label}_ms"), "ms", &durations),
        metric(
            &format!("engine_scan_{label}_per_file_ms"),
            "ms/file",
            &rates,
        ),
    )
}

fn seed_records(store: &mut SqliteIndexStore, count: usize) {
    let exts = ["pdf", "docx", "txt", "mp3", "png"];
    let mut records = Vec::with_capacity(count.min(1000));
    for i in 0..count {
        let ext = exts[i % exts.len()];
        let name = if i % 7 == 0 {
            format!("高等数学-第{}章-notes.{ext}", i % 20 + 1)
        } else {
            format!("file{i:06}.{ext}")
        };
        let path = format!("C:/docs/d{:03}/{name}", i % 100);
        let labels = match ext {
            "mp3" => "audio",
            "png" => "image",
            _ if i % 3 == 0 => "document,course-c-demo-1",
            _ => "document",
        };
        let mut record = FileRecord::new(&path, (i % 1024) as i64, i as i64, "indexed");
        record.file_type = ext.to_string();
        record.labels = labels.to_string();
        records.push(record);
        if records.len() == 1000 {
            store.upsert_many(&records).unwrap();
            records.clear();
        }
    }
    if !records.is_empty() {
        store.upsert_many(&records).unwrap();
    }
}

fn bench_queries(store: &mut SqliteIndexStore, samples: usize) -> Vec<(String, Vec<Duration>)> {
    let mut cases: Vec<(String, FileQuery)> = vec![
        ("query_text".into(), parse_query("notes")),
        ("query_type".into(), parse_query("type:pdf")),
        ("query_label".into(), parse_query("label:course-c-demo-1")),
        ("query_combined".into(), parse_query("type:pdf 高等数学")),
    ];
    let mut paged = FileQuery::default();
    paged.limit = 50;
    paged.offset = 5000;
    cases.push(("query_paged".into(), paged));

    let mut results = Vec::new();
    for (name, query) in cases {
        let mut durations = Vec::with_capacity(samples);
        for _ in 0..samples {
            let start = Instant::now();
            store.query(&query).unwrap();
            durations.push(start.elapsed());
        }
        results.push((name, durations));
    }
    results
}

fn bench_archive(samples: usize, files: usize) -> (Vec<Duration>, Vec<Duration>) {
    let pid = std::process::id();
    let root = env::temp_dir().join(format!("rootup_bench_archive_{pid}"));
    let archive_root = env::temp_dir().join(format!("rootup_bench_archive_root_{pid}"));
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&archive_root);
    fs::create_dir_all(&root).unwrap();

    let store: Arc<Mutex<dyn IndexStore>> =
        Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
    let mut records = Vec::with_capacity(files);
    let mut paths = Vec::with_capacity(files);
    for i in 0..files {
        let path = format!("{}/file{i:04}.pdf", root.to_string_lossy());
        let _ = fs::File::create(&path).unwrap();
        let mut record = FileRecord::new(&path.replace('\\', "/"), 10, i as i64, "indexed");
        record.file_type = "pdf".into();
        record.labels = "document".into();
        records.push(record);
        paths.push(path.replace('\\', "/"));
    }
    store.lock().unwrap().upsert_many(&records).unwrap();

    let mut archive_durations = Vec::with_capacity(samples);
    let mut undo_durations = Vec::with_capacity(samples);
    for sample in 0..samples {
        let batch = 1000 + sample as i64;
        let start = Instant::now();
        archive_files(&store, &archive_root.to_string_lossy(), &paths, batch).unwrap();
        archive_durations.push(start.elapsed());

        let start = Instant::now();
        undo_file_batch(&store, batch).unwrap();
        undo_durations.push(start.elapsed());
    }
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&archive_root);
    (archive_durations, undo_durations)
}

fn main() {
    let version = env::var("ROOTUP_BENCH_VERSION").unwrap_or_else(|_| "dev".into());
    let samples = env_usize("ROOTUP_BENCH_SAMPLES", 5);
    let full = env_flag("ROOTUP_BENCH_FULL");
    let small = env_flag("ROOTUP_BENCH_SMALL");
    let scan_files = if small { 1_000 } else { 10_000 };
    let scan_label = if small { "1k" } else { "10k" };
    let query_count = if small { 10_000 } else { 100_000 };
    let archive_files_count = if small { 100 } else { 1_000 };

    let mut metrics = Value::Object(Default::default());

    let scan_root = env::temp_dir().join(format!("rootup_bench_scan_{}", std::process::id()));
    let _ = fs::remove_dir_all(&scan_root);
    let start = Instant::now();
    make_scan_fixture(&scan_root, scan_files);
    let fixture_secs = start.elapsed().as_secs_f64();
    println!("engine_bench: fixture {scan_files} files in {fixture_secs:.1}s");

    let (scan_ms, per_file) = bench_scan(&scan_root, samples, scan_label);
    merge(&mut metrics, scan_ms);
    merge(&mut metrics, per_file);
    let _ = fs::remove_dir_all(&scan_root);

    if full {
        let full_root =
            env::temp_dir().join(format!("rootup_bench_scan_full_{}", std::process::id()));
        let _ = fs::remove_dir_all(&full_root);
        let start = Instant::now();
        make_scan_fixture(&full_root, 100_000);
        println!(
            "engine_bench: fixture 100k files in {:.1}s",
            start.elapsed().as_secs_f64()
        );
        let (scan_ms, per_file) = bench_scan(&full_root, samples.min(3), "100k");
        merge(&mut metrics, scan_ms);
        merge(&mut metrics, per_file);
        let _ = fs::remove_dir_all(&full_root);
    }

    let mut store = SqliteIndexStore::open(":memory:").unwrap();
    seed_records(&mut store, query_count);
    for (name, durations) in bench_queries(&mut store, samples) {
        merge(
            &mut metrics,
            metric(&format!("engine_{name}_ms"), "ms", &durations),
        );
    }

    let mut study = StudyClassifier::new();
    study.refresh(&seed_study_data());
    let mut chain = ClassifierChain::new(vec![
        Box::new(ExtensionClassifier::new()) as Box<dyn Classifier>
    ]);
    chain.push(Box::new(study));
    let mut reapply = Vec::with_capacity(samples);
    for _ in 0..samples {
        let start = Instant::now();
        reapply_labels(&mut store, &chain).unwrap();
        reapply.push(start.elapsed());
    }
    merge(
        &mut metrics,
        metric("engine_reapply_labels_ms", "ms", &reapply),
    );

    let (archive_ms, undo_ms) = bench_archive(samples, archive_files_count);
    merge(
        &mut metrics,
        metric("engine_archive_files_ms", "ms", &archive_ms),
    );
    merge(&mut metrics, metric("engine_undo_files_ms", "ms", &undo_ms));

    let out = env::var("ROOTUP_BENCH_OUT")
        .unwrap_or_else(|_| format!("../benchmarks/results/{version}.engine.json"));
    let out_path = PathBuf::from(&out);
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&out_path, serde_json::to_string_pretty(&metrics).unwrap()).unwrap();
    println!("engine_bench: wrote {out}");
}

fn merge(target: &mut Value, patch: Value) {
    if let (Value::Object(t), Value::Object(p)) = (target, patch) {
        t.extend(p);
    }
}
