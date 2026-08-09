#!/usr/bin/env python3
"""Compare two RootUp index DB snapshots (walkdir scan vs MFT scan) under a root.

Usage: mft_db_compare.py <walk_db> <mft_db> <root> <out_md> <label>
Writes one markdown row to out_md and exits 0 when the two result sets match
within the tolerance (0.1% size/time mismatches, no path-set difference).
"""

import sqlite3
import sys


def load(db_path, root):
    # DB 内路径统一为前斜杠；脚本传入的根路径可能是反斜杠风格。
    root = root.replace("\\", "/").rstrip("/")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT path, size, modified FROM files "
        "WHERE state != 'deleted' "
        "AND (LOWER(path) = LOWER(?) OR LOWER(path) LIKE LOWER(?))",
        (root, root.rstrip("/") + "/%"),
    ).fetchall()
    conn.close()
    return {p: (s, m) for p, s, m in rows}


def main():
    walk_db, mft_db, root, out_md, label = sys.argv[1:6]
    walk = load(walk_db, root)
    mft = load(mft_db, root)
    walk_only = sorted(set(walk) - set(mft))
    mft_only = sorted(set(mft) - set(walk))
    size_mismatch = []
    time_mismatch = []
    for p in sorted(set(walk) & set(mft)):
        w, m = walk[p], mft[p]
        if w[0] != m[0]:
            size_mismatch.append((p, w[0], m[0]))
        if w[1] != m[1]:
            time_mismatch.append((p, w[1], m[1]))
    total = max(len(walk), len(mft), 1)
    ratio = (len(size_mismatch) + len(time_mismatch)) / total
    set_ok = not walk_only and not mft_only
    ok = set_ok and ratio <= 0.001
    with open(out_md, "a", encoding="utf-8") as f:
        f.write(
            f"| {label} | {len(walk)} | {len(mft)} | {len(walk_only)} | "
            f"{len(mft_only)} | {len(size_mismatch)} | {len(time_mismatch)} | "
            f"{ratio:.4%} | {'PASS' if ok else 'FAIL'} |\n"
        )
    if not ok:
        print(f"label={label} walk={len(walk)} mft={len(mft)} "
              f"walk_only={len(walk_only)} mft_only={len(mft_only)} "
              f"size_mismatch={len(size_mismatch)} time_mismatch={len(time_mismatch)}")
        for p in walk_only[:10]:
            print("  walk_only:", p)
        for p in mft_only[:10]:
            print("  mft_only:", p)
        for p, w, m in size_mismatch[:10]:
            print(f"  size {p}: walk={w} mft={m}")
        for p, w, m in time_mismatch[:10]:
            print(f"  time {p}: walk={w} mft={m}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
