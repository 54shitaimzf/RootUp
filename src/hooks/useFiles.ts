import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { mergeFiles } from "../lib/fileUtils";
import { APP_EVENTS } from "../lib/events";
import {
  logEvent,
  queryFiles,
  type FileRecord,
  type SortDir,
  type SortField,
} from "../lib/tauri";

/**
 * 文件索引查询：后端 query_files 分页加载 + 监听 files-changed 实时合并。
 * 有查询或非首页时，实时事件只标记 stale，由用户刷新重新拉取。
 */
export function useFiles(
  query: string,
  limit: number,
  offset: number,
  refreshKey: number,
  sortBy?: SortField | null,
  sortDir?: SortDir,
) {
  const [items, setItems] = useState<FileRecord[]>([]);
  /** 精确总数；后端 totalKnown=false 时为 null（前端不得展示未知总数） */
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const cursor = offset === 0 ? null : nextCursor;
    queryFiles(query, limit, offset, sortBy, sortDir, cursor)
      .then((page) => {
        if (cancelled) return;
        setTotal(page.totalKnown ? page.total : null);
        setNextCursor(page.nextCursor);
        setStale(false);
        setItems((prev) =>
          offset === 0
            ? page.items
            : mergeFiles(prev, page.items, offset + limit),
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
  }, [query, limit, offset, refreshKey, sortBy, sortDir]);

  // 监听回调只读瞬时值：经 ref 读取筛选/翻页状态，订阅只建立一次，
  // 避免每次查询变化都注销重订阅（异步注册间隙会漏掉 files-changed 事件）。
  const latest = useRef({ query, offset, limit });
  latest.current = { query, offset, limit };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<FileRecord[]>(APP_EVENTS.filesChanged, (event) => {
      const { query: currentQuery, offset: currentOffset, limit: currentLimit } =
        latest.current;
      const hasFilter = currentQuery.trim() !== "";
      if (!hasFilter && currentOffset === 0) {
        setItems((prev) =>
          mergeFiles(
            prev,
            event.payload,
            Math.max(prev.length, currentLimit),
          ),
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
  }, []);

  return { items, total, loading, stale, hasMore: nextCursor !== null };
}
