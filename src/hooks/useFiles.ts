import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadMoreMerge, mergeFiles } from "../lib/fileUtils";
import { logEvent, queryFiles, type FileRecord } from "../lib/tauri";

/**
 * 文件索引查询：后端 query_files 分页加载 + 监听 files-changed 实时合并。
 * 有查询或非首页时，实时事件只标记 stale，由用户刷新重新拉取。
 */
export function useFiles(
  query: string,
  limit: number,
  offset: number,
  refreshKey: number,
) {
  const [items, setItems] = useState<FileRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryFiles(query, limit, offset)
      .then((page) => {
        if (cancelled) return;
        setTotal(page.total);
        setStale(false);
        setItems((prev) =>
          offset === 0
            ? page.items
            : loadMoreMerge(prev, page.items, offset + limit),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        void logEvent("error", `加载文件索引失败: ${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, limit, offset, refreshKey]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<FileRecord[]>("files-changed", (event) => {
      const hasFilter = query.trim() !== "";
      if (!hasFilter && offset === 0) {
        setItems((prev) =>
          mergeFiles(prev, event.payload, Math.max(prev.length, limit)),
        );
      } else {
        setStale(true);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        void logEvent("warn", `监听 files-changed 失败: ${String(err)}`);
      });
    return () => {
      unlisten?.();
    };
  }, [query, offset, limit]);

  return { items, total, loading, stale };
}
