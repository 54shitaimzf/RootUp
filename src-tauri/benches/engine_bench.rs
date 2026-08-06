//! 引擎性能基准 v2（自研 harness，零第三方基准依赖）。
//! 运行：`cargo bench --features bench`（release 优化）。
//! 环境变量：ROOTUP_BENCH_VERSION / ROOTUP_BENCH_SAMPLES / ROOTUP_BENCH_OUT /
//! ROOTUP_BENCH_SMALL / ROOTUP_BENCH_FULL / ROOTUP_BENCH_HUGE。

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
use rusqlite::Connection;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ---------- 确定性 RNG ----------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn range(&mut self, n: u64) -> usize {
        (self.next() % n.max(1)) as usize
    }

    fn ratio(&mut self) -> f64 {
        (self.next() % 1000) as f64 / 1000.0
    }
}

// ---------- 语料规范 ----------

struct CorpusSpec {
    seed: u64,
    extensions: Vec<(String, u32)>,
    noise_dirs: Vec<String>,
    unicode_ratio: f64,
}

fn load_corpus() -> CorpusSpec {
    let raw =
        fs::read_to_string("../benchmarks/specs/corpus.json").unwrap_or_else(|_| "{}".to_string());
    let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    let mut extensions = Vec::new();
    if let Some(map) = v.get("extensions").and_then(|e| e.as_object()) {
        for (ext, weight) in map {
            if let Some(w) = weight.as_u64() {
                extensions.push((ext.clone(), w as u32));
            }
        }
    }
    if extensions.is_empty() {
        extensions = vec![
            ("pdf".into(), 12),
            ("docx".into(), 8),
            ("txt".into(), 15),
            ("rs".into(), 8),
            ("png".into(), 10),
            ("mp3".into(), 6),
            ("zip".into(), 5),
        ];
    }
    let mut noise_dirs = Vec::new();
    if let Some(arr) = v.get("noiseDirs").and_then(|e| e.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                noise_dirs.push(s.to_string());
            }
        }
    }
    if noise_dirs.is_empty() {
        noise_dirs = vec![
            "node_modules".into(),
            ".git".into(),
            "target".into(),
            "dist".into(),
            "__pycache__".into(),
        ];
    }
    let seed = v.get("seed").and_then(|s| s.as_u64()).unwrap_or(20260806);
    let unicode_ratio = v
        .get("unicodeNameRatio")
        .and_then(|r| r.as_f64())
        .unwrap_or(0.3);
    CorpusSpec {
        seed,
        extensions,
        noise_dirs,
        unicode_ratio,
    }
}

fn weighted_ext(spec: &CorpusSpec, rng: &mut Rng) -> String {
    let total: u32 = spec.extensions.iter().map(|(_, w)| *w).sum();
    let mut pick = rng.range(total as u64) as u32;
    for (ext, weight) in &spec.extensions {
        if pick < *weight {
            return ext.clone();
        }
        pick -= *weight;
    }
    spec.extensions[0].0.clone()
}

fn shape_dir(shape: &str, i: usize, spec: &CorpusSpec, rng: &mut Rng) -> String {
    match shape {
        "wide" => format!("d{:03}", i % 100),
        "deep" => {
            let mut parts = Vec::new();
            let mut v = i;
            for _ in 0..8 {
                parts.push(format!("n{}", v % 8));
                v /= 8;
            }
            parts.join("/")
        }
        "noise" if i.is_multiple_of(5) => {
            let dir = &spec.noise_dirs[rng.range(spec.noise_dirs.len() as u64)];
            format!("{dir}/pkg{}", i % 20)
        }
        "noise" => {
            let dirs = [
                "docs",
                "images",
                "music",
                "code",
                "projects",
                "courses/高等数学",
                "courses/大学物理",
                "downloads",
            ];
            dirs[i % dirs.len()].to_string()
        }
        _ => {
            let dirs = [
                "docs",
                "images",
                "music",
                "code",
                "projects",
                "courses/高等数学",
                "courses/大学物理",
                "downloads",
            ];
            dirs[i % dirs.len()].to_string()
        }
    }
}

fn file_size(rng: &mut Rng) -> usize {
    let r = rng.ratio();
    if r < 0.7 {
        rng.range(4096)
    } else if r < 0.9 {
        4096 + rng.range(32768 - 4096)
    } else {
        32768 + rng.range(65536 - 32768)
    }
}

/// 生成真实磁盘语料（formal 文件，含 Unicode 名称与形状差异），返回文件数。
fn generate_disk(root: &Path, shape: &str, count: usize, spec: &CorpusSpec) -> usize {
    let mut rng = Rng::new(
        spec.seed
            .wrapping_add(count as u64)
            .wrapping_add(shape.len() as u64),
    );
    let mut created = 0;
    for i in 0..count {
        let dir = root.join(shape_dir(shape, i, spec, &mut rng));
        fs::create_dir_all(&dir).unwrap();
        let ext = weighted_ext(spec, &mut rng);
        let name = if rng.ratio() < spec.unicode_ratio {
            format!("高等数学-第{}章-资料{i}.{ext}", i % 20 + 1)
        } else {
            format!("file{i:06}.{ext}")
        };
        let path = dir.join(name);
        let bytes = vec![0u8; file_size(&mut rng).min(1024 * 1024)];
        fs::write(&path, bytes).unwrap();
        created += 1;
    }
    created
}

// ---------- 统计 ----------

fn stats(values: &[Duration], unit: &str) -> Value {
    let mut ms: Vec<f64> = values.iter().map(|d| d.as_secs_f64() * 1000.0).collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = ms.len();
    let pct = |p: f64| -> f64 {
        if n == 0 {
            0.0
        } else {
            let idx = ((n as f64) * p).ceil() as usize;
            ms[idx.min(n - 1)]
        }
    };
    let sum: f64 = ms.iter().sum();
    let mean = if n == 0 { 0.0 } else { sum / n as f64 };
    let variance = if n == 0 {
        0.0
    } else {
        ms.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n as f64
    };
    json!({
        "unit": unit,
        "p50": pct(0.5),
        "p90": pct(0.9),
        "p99": pct(0.99),
        "min": ms.first().copied().unwrap_or(0.0),
        "max": ms.last().copied().unwrap_or(0.0),
        "mean": mean,
        "cv": if mean.abs() < 1e-9 { 0.0 } else { variance.sqrt() / mean },
        "samples": n,
    })
}

fn metric(name: &str, unit: &str, values: &[Duration], out: &mut Value) {
    if let Value::Object(map) = out {
        map.insert(name.to_string(), stats(values, unit));
    }
}

// ---------- 扫描 ----------

struct Sink(Arc<Mutex<Vec<ScanEvent>>>);

impl ScanEventSink for Sink {
    fn on_event(&self, event: ScanEvent) {
        self.0.lock().unwrap().push(event);
    }
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

fn scan_once(dir: &Path) -> (Duration, ScanSummary) {
    let store: Arc<Mutex<dyn IndexStore>> =
        Arc::new(Mutex::new(SqliteIndexStore::open(":memory:").unwrap()));
    let sink = Arc::new(Sink(Arc::new(Mutex::new(Vec::new()))));
    let mut service = ScanService::new(
        store.clone(),
        Arc::new(ExtensionClassifier::new()),
        IgnoreMatcher::new(),
        ScanParams::default(),
        sink.clone(),
    );
    let start = Instant::now();
    service.enqueue(dir.to_string_lossy().to_string());
    service.start();
    let summary = wait_scan(sink.0.clone(), Duration::from_secs(600)).unwrap();
    let count = store.lock().unwrap().count().unwrap();
    assert_eq!(
        count,
        summary.added as i64 + summary.updated as i64,
        "scan count must match summary"
    );
    (start.elapsed(), summary)
}

fn bench_scan_shapes(root: &Path, shapes: &[&str], count: usize, samples: usize) -> Value {
    let mut out = Value::Object(Default::default());
    for shape in shapes {
        let mut durations = Vec::new();
        let mut per_file = Vec::new();
        for _ in 0..samples {
            let (elapsed, summary) = scan_once(root);
            durations.push(elapsed);
            per_file.push(Duration::from_secs_f64(
                1.0 / summary.files_per_sec.max(0.001),
            ));
        }
        let base = format!("engine_scan_{shape}_{}", count_label(count));
        metric(&format!("{base}_ms"), "ms", &durations, &mut out);
        metric(
            &format!("{base}_per_file_ms"),
            "ms/file",
            &per_file,
            &mut out,
        );
    }
    out
}

fn bench_warm_rescan(root: &Path, samples: usize) -> Value {
    let mut out = Value::Object(Default::default());
    let mut durations = Vec::new();
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
        service.enqueue(root.to_string_lossy().to_string());
        service.start();
        wait_scan(sink.0.clone(), Duration::from_secs(600)).unwrap();
        sink.0.lock().unwrap().clear();
        let start = Instant::now();
        service.enqueue(root.to_string_lossy().to_string());
        wait_scan(sink.0.clone(), Duration::from_secs(600)).unwrap();
        durations.push(start.elapsed());
    }
    metric("engine_rescan_10k_ms", "ms", &durations, &mut out);
    out
}

fn count_label(count: usize) -> &'static str {
    match count {
        1_000 => "1k",
        10_000 => "10k",
        100_000 => "100k",
        300_000 => "300k",
        _ => "custom",
    }
}

// ---------- 索引与查询 ----------

fn seed_records(store: &mut SqliteIndexStore, count: usize, seed: u64) {
    let exts = ["pdf", "docx", "txt", "mp3", "png", "rs", "zip"];
    let mut rng = Rng::new(seed);
    let mut records = Vec::with_capacity(1000);
    for i in 0..count {
        let ext = exts[rng.range(exts.len() as u64)];
        let name = if rng.ratio() < 0.3 {
            format!("高等数学-第{}章-notes-{i}.{ext}", i % 20 + 1)
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

fn bench_index_build(count: usize, samples: usize) -> Value {
    let mut out = Value::Object(Default::default());
    let mut durations = Vec::new();
    for sample in 0..samples {
        let mut store = SqliteIndexStore::open(":memory:").unwrap();
        let start = Instant::now();
        seed_records(&mut store, count, 20260000 + sample as u64);
        durations.push(start.elapsed());
        assert_eq!(store.count().unwrap(), count as i64);
    }
    metric(
        &format!("engine_index_build_{}_ms", count_label(count)),
        "ms",
        &durations,
        &mut out,
    );
    out
}

fn bench_queries(store: &mut SqliteIndexStore, samples: usize) -> Value {
    let mut out = Value::Object(Default::default());
    let cases: Vec<(String, FileQuery)> = vec![
        ("query_text".into(), parse_query("notes")),
        ("query_type".into(), parse_query("type:pdf")),
        ("query_label".into(), parse_query("label:course-c-demo-1")),
        ("query_combined".into(), parse_query("type:pdf 高等数学")),
    ];
    let paged = FileQuery {
        limit: 50,
        offset: 5000,
        ..Default::default()
    };
    for (name, query) in cases {
        let mut durations = Vec::new();
        for _ in 0..samples {
            let start = Instant::now();
            let page = store.query(&query).unwrap();
            assert!(page.total > 0, "{name} must return results");
            durations.push(start.elapsed());
        }
        metric(&format!("engine_{name}_ms"), "ms", &durations, &mut out);
    }
    let mut durations = Vec::new();
    for _ in 0..samples {
        let start = Instant::now();
        let page = store.query(&paged).unwrap();
        assert_eq!(page.items.len(), 50);
        durations.push(start.elapsed());
    }
    metric("engine_query_paged_ms", "ms", &durations, &mut out);
    out
}

fn bench_cold_queries(count: usize, samples: usize) -> Value {
    let mut out = Value::Object(Default::default());
    let pid = std::process::id();
    let db = env::temp_dir().join(format!("rootup_bench_query_{pid}.db"));
    let _ = fs::remove_file(&db);
    {
        let mut store = SqliteIndexStore::open(db.to_str().unwrap()).unwrap();
        seed_records(&mut store, count, 20260001);
    }
    let cases: Vec<(String, FileQuery)> = vec![
        ("query_text_cold".into(), parse_query("notes")),
        (
            "query_label_cold".into(),
            parse_query("label:course-c-demo-1"),
        ),
    ];
    for (name, query) in cases {
        let mut durations = Vec::new();
        for _ in 0..samples {
            let store = SqliteIndexStore::open(db.to_str().unwrap()).unwrap();
            let start = Instant::now();
            let page = store.query(&query).unwrap();
            assert!(page.total > 0);
            durations.push(start.elapsed());
        }
        metric(&format!("engine_{name}_ms"), "ms", &durations, &mut out);
    }
    let _ = fs::remove_file(&db);
    out
}

// ---------- 重分类 / 归档 / churn ----------

fn bench_reapply(store: &mut SqliteIndexStore, samples: usize) -> Value {
    let mut out = Value::Object(Default::default());
    let mut study = StudyClassifier::new();
    study.refresh(&seed_study_data());
    let mut chain = ClassifierChain::new(vec![
        Box::new(ExtensionClassifier::new()) as Box<dyn Classifier>
    ]);
    chain.push(Box::new(study));
    let mut durations = Vec::new();
    for _ in 0..samples {
        let start = Instant::now();
        let changed = reapply_labels(store, &chain).unwrap();
        assert!(changed >= 0);
        durations.push(start.elapsed());
    }
    metric("engine_reapply_labels_ms", "ms", &durations, &mut out);
    out
}

fn bench_archive(samples: usize, files: usize) -> Value {
    let mut out = Value::Object(Default::default());
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
        fs::write(&path, b"x").unwrap();
        let mut record = FileRecord::new(&path.replace('\\', "/"), 10, i as i64, "indexed");
        record.file_type = "pdf".into();
        record.labels = "document".into();
        records.push(record);
        paths.push(path.replace('\\', "/"));
    }
    store.lock().unwrap().upsert_many(&records).unwrap();

    let mut archive_durations = Vec::new();
    let mut undo_durations = Vec::new();
    for sample in 0..samples {
        let batch = 1000 + sample as i64;
        let start = Instant::now();
        let outcome =
            archive_files(&store, &archive_root.to_string_lossy(), &paths, batch).unwrap();
        assert_eq!(outcome.archived, files);
        archive_durations.push(start.elapsed());
        let start = Instant::now();
        let outcome = undo_file_batch(&store, batch).unwrap();
        assert_eq!(outcome.archived, files);
        undo_durations.push(start.elapsed());
    }
    metric(
        "engine_archive_files_ms",
        "ms",
        &archive_durations,
        &mut out,
    );
    metric("engine_undo_files_ms", "ms", &undo_durations, &mut out);
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&archive_root);
    out
}

fn db_bytes(path: &Path) -> u64 {
    let mut total = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{suffix}", path.display()));
        if let Ok(meta) = fs::metadata(side) {
            total += meta.len();
        }
    }
    total
}

fn bench_churn(records: usize, cycles: usize) -> Value {
    let mut out = Value::Object(Default::default());
    let pid = std::process::id();
    let db = env::temp_dir().join(format!("rootup_bench_churn_{pid}.db"));
    let _ = fs::remove_file(&db);
    let mut store = SqliteIndexStore::open(db.to_str().unwrap()).unwrap();
    seed_records(&mut store, records, 20260002);
    let before = db_bytes(&db);

    for cycle in 0..cycles {
        let mut adds = Vec::new();
        let mut deletes = Vec::new();
        for i in 0..5000 {
            let path = format!("C:/churn/add_{cycle}_{i}.pdf");
            let mut record = FileRecord::new(&path, 10, i as i64, "indexed");
            record.labels = "document".into();
            adds.push(record);
            deletes.push(format!("C:/churn/del_{cycle}_{i}.pdf"));
        }
        store.upsert_many(&adds).unwrap();
        store.mark_deleted(&deletes[0]).unwrap();
    }
    let after = db_bytes(&db);
    Connection::open(&db)
        .and_then(|conn| conn.execute_batch("VACUUM"))
        .ok();
    let vacuum = db_bytes(&db);

    if let Value::Object(map) = &mut out {
        map.insert(
            "engine_churn_db_kb_before".into(),
            json!({
                "unit": "KB",
                "p50": before as f64 / 1024.0,
                "p90": before as f64 / 1024.0,
                "p99": before as f64 / 1024.0,
                "min": before as f64 / 1024.0,
                "max": before as f64 / 1024.0,
                "mean": before as f64 / 1024.0,
                "cv": 0.0,
                "samples": 1
            }),
        );
        map.insert(
            "engine_churn_db_kb_after".into(),
            json!({
                "unit": "KB",
                "p50": after as f64 / 1024.0,
                "p90": after as f64 / 1024.0,
                "p99": after as f64 / 1024.0,
                "min": after as f64 / 1024.0,
                "max": after as f64 / 1024.0,
                "mean": after as f64 / 1024.0,
                "cv": 0.0,
                "samples": 1
            }),
        );
        map.insert(
            "engine_churn_db_kb_vacuum".into(),
            json!({
                "unit": "KB",
                "p50": vacuum as f64 / 1024.0,
                "p90": vacuum as f64 / 1024.0,
                "p99": vacuum as f64 / 1024.0,
                "min": vacuum as f64 / 1024.0,
                "max": vacuum as f64 / 1024.0,
                "mean": vacuum as f64 / 1024.0,
                "cv": 0.0,
                "samples": 1
            }),
        );
    }
    let _ = fs::remove_file(&db);
    let _ = fs::remove_file(format!("{}-wal", db.display()));
    let _ = fs::remove_file(format!("{}-shm", db.display()));
    out
}

// ---------- 主流程 ----------

fn env_flag(name: &str) -> bool {
    env::var(name).map(|v| v == "1").unwrap_or(false)
}

fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn main() {
    let version = env::var("ROOTUP_BENCH_VERSION").unwrap_or_else(|_| "dev".into());
    let samples = env_usize("ROOTUP_BENCH_SAMPLES", 5);
    let small = env_flag("ROOTUP_BENCH_SMALL");
    let full = env_flag("ROOTUP_BENCH_FULL");
    let huge = env_flag("ROOTUP_BENCH_HUGE");
    let spec = load_corpus();
    let disk_count = if small { 1_000 } else { 10_000 };
    let memory_count = if small { 10_000 } else { 100_000 };
    let archive_files_count = if small { 100 } else { 1_000 };
    let shapes = vec!["wide", "deep", "mixed", "noise"];

    let mut metrics = Value::Object(Default::default());

    // 磁盘扫描（形状矩阵）
    let scan_root = env::temp_dir().join(format!("rootup_bench_scan_{}", std::process::id()));
    let _ = fs::remove_dir_all(&scan_root);
    let start = Instant::now();
    let created = generate_disk(&scan_root, "mixed", disk_count, &spec);
    println!(
        "engine_bench: fixture {created} files in {:.1}s",
        start.elapsed().as_secs_f64()
    );
    merge(
        &mut metrics,
        bench_scan_shapes(&scan_root, &shapes, disk_count, samples.min(3)),
    );
    merge(&mut metrics, bench_warm_rescan(&scan_root, samples.min(3)));
    let _ = fs::remove_dir_all(&scan_root);

    if full {
        let full_root =
            env::temp_dir().join(format!("rootup_bench_scan_full_{}", std::process::id()));
        let _ = fs::remove_dir_all(&full_root);
        let start = Instant::now();
        generate_disk(&full_root, "mixed", 100_000, &spec);
        println!(
            "engine_bench: fixture 100k in {:.1}s",
            start.elapsed().as_secs_f64()
        );
        merge(
            &mut metrics,
            bench_scan_shapes(&full_root, &["mixed"], 100_000, 3),
        );
        let _ = fs::remove_dir_all(&full_root);
    }
    if huge {
        let huge_root =
            env::temp_dir().join(format!("rootup_bench_scan_huge_{}", std::process::id()));
        let _ = fs::remove_dir_all(&huge_root);
        generate_disk(&huge_root, "mixed", 300_000, &spec);
        merge(
            &mut metrics,
            bench_scan_shapes(&huge_root, &["mixed"], 300_000, 2),
        );
        let _ = fs::remove_dir_all(&huge_root);
    }

    // 内存级：索引构建、查询（暖/冷）、重分类、churn
    merge(
        &mut metrics,
        bench_index_build(memory_count, samples.min(3)),
    );
    let mut store = SqliteIndexStore::open(":memory:").unwrap();
    seed_records(&mut store, memory_count, 20260003);
    merge(&mut metrics, bench_queries(&mut store, samples));
    merge(&mut metrics, bench_reapply(&mut store, samples));
    merge(
        &mut metrics,
        bench_cold_queries(memory_count, samples.min(3)),
    );
    merge(&mut metrics, bench_churn(50_000, 2));

    // 归档 / 撤销
    merge(
        &mut metrics,
        bench_archive(samples.min(3), archive_files_count),
    );

    let result = json!({
        "schema": 2,
        "scenario": {
            "name": "engine_v2",
            "fixture": {
                "spec": "corpus.json",
                "seed": spec.seed,
                "shapes": shapes,
                "diskCount": disk_count,
                "memoryCount": memory_count,
                "full": full,
                "huge": huge
            },
            "state": "cold_warm_churn",
            "samples": samples,
            "warmup": 2
        },
        "metrics": metrics
    });

    let out = env::var("ROOTUP_BENCH_OUT")
        .unwrap_or_else(|_| format!("../benchmarks/results/{version}.engine.json"));
    let out_path = PathBuf::from(&out);
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&out_path, serde_json::to_string_pretty(&result).unwrap()).unwrap();
    println!("engine_bench: wrote {out}");
}

fn merge(target: &mut Value, patch: Value) {
    if let (Value::Object(t), Value::Object(p)) = (target, patch) {
        t.extend(p);
    }
}
