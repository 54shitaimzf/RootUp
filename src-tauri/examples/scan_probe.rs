//! 0.8.6 本地性能探针（实验验证用；bench 特性门控，不进入默认构建）：
//! 运行：`cargo run --release --example scan_probe --features bench [N|真实目录路径]`。

use rootup_lib::core::ignore::IgnoreMatcher;
use rootup_lib::core::index::{FileRecord, IndexStore, ScanDiffStore};
use rootup_lib::core::path::normalize_path;
use rootup_lib::core::scan::FileEnumerator;
use rootup_lib::infra::enumerator::{WalkDirEnumerator, Win32Enumerator};
use rootup_lib::infra::index_store::SqliteIndexStore;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

fn p50(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    values[values.len() / 2]
}

fn main() {
    let arg = std::env::args().nth(1);
    let (root, label) = match arg {
        Some(p) if Path::new(&p).is_dir() => (normalize_path(&p), format!("real:{p}")),
        Some(p) => {
            let count: usize = p.parse().unwrap_or(20_000);
            (make_corpus(count, "synth"), format!("synth:{count}"))
        }
        None => (make_corpus(20_000, "synth"), "synth:20000".to_string()),
    };

    // ---------- B：Win32 vs walkdir ----------
    let matcher = IgnoreMatcher::new();
    let skip = Arc::new(Mutex::new(Vec::<String>::new()));
    let walk = WalkDirEnumerator::new(matcher.clone(), skip.clone());
    let win = Win32Enumerator::new(matcher, skip);

    let mut walk_times = Vec::new();
    let mut win_times = Vec::new();
    let mut counts = (0usize, 0usize);
    let mut stats_pair = None;
    for round in 0..3 {
        let t = Instant::now();
        let mut n = 0usize;
        let ws = walk
            .enumerate(&root, &mut |_| {
                n += 1;
                true
            })
            .unwrap();
        walk_times.push(t.elapsed().as_secs_f64() * 1000.0);
        counts.0 = n;

        let t = Instant::now();
        let mut n = 0usize;
        let vs = win
            .enumerate(&root, &mut |_| {
                n += 1;
                true
            })
            .unwrap();
        win_times.push(t.elapsed().as_secs_f64() * 1000.0);
        counts.1 = n;
        stats_pair = Some((ws, vs));
        assert_eq!(counts.0, counts.1, "B 计数不一致 round={round}");
    }
    let (ws, vs) = stats_pair.unwrap();
    let walk_p50 = p50(walk_times);
    let win_p50 = p50(win_times);
    println!(
        "B {label} walkdir_p50_ms={walk_p50:.1} win32_p50_ms={win_p50:.1} speedup={:.2}x files={} stats_walk=({},{},{}) stats_win=({},{},{})",
        walk_p50 / win_p50,
        counts.0,
        ws.discovered,
        ws.ignored,
        ws.errors,
        vs.discovered,
        vs.ignored,
        vs.errors,
    );
    if !label.starts_with("real:") {
        let _ = std::fs::remove_dir_all(&root);
    }

    // ---------- F：DB 批量写入 ----------
    let records: Vec<FileRecord> = (0..50_000)
        .map(|i| {
            FileRecord::new(
                &format!("C:/probe/d{:03}/f{i:06}.txt", i % 100),
                (i % 1024) as i64,
                1_700_000_000_000 + i as i64,
                "indexed",
            )
        })
        .collect();
    let keys: Vec<String> = records.iter().map(|r| r.path.clone()).collect();

    let mut insert_ms = Vec::new();
    let mut update_ms = Vec::new();
    let mut seen_ms = Vec::new();
    for _ in 0..3 {
        let mut store = SqliteIndexStore::open(":memory:").unwrap();
        let t = Instant::now();
        store.upsert_many(&records).unwrap();
        insert_ms.push(t.elapsed().as_secs_f64() * 1000.0);

        let t = Instant::now();
        store.upsert_many(&records).unwrap();
        update_ms.push(t.elapsed().as_secs_f64() * 1000.0);

        let mut store = SqliteIndexStore::open(":memory:").unwrap();
        store.begin_scan_diff("C:/probe").unwrap();
        let t = Instant::now();
        store.mark_scan_seen(&keys).unwrap();
        seen_ms.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let insert_p50 = p50(insert_ms);
    let update_p50 = p50(update_ms);
    let seen_p50 = p50(seen_ms);
    println!(
        "F upsert_insert_50k_p50_ms={insert_p50:.1} upsert_update_50k_p50_ms={update_p50:.1} scan_seen_50k_p50_ms={seen_p50:.1}",
    );
}

fn make_corpus(count: usize, tag: &str) -> String {
    let corpus =
        std::env::temp_dir().join(format!("rootup_probe_corpus_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&corpus);
    let t0 = Instant::now();
    for d in 0..100usize {
        std::fs::create_dir_all(corpus.join(format!("d{d:03}"))).unwrap();
    }
    for i in 0..count {
        std::fs::write(corpus.join(format!("d{:03}/f{i:06}.txt", i % 100)), b"x").unwrap();
    }
    println!(
        "corpus files={count} create_ms={:.0}",
        t0.elapsed().as_secs_f64() * 1000.0
    );
    normalize_path(&corpus.to_string_lossy())
}
