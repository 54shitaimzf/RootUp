import { useCallback, useState } from "react";
import {
  archiveFiles,
  archiveFiltered,
  logEvent,
  undoArchive,
  type ArchiveFailure,
  type FileRecord,
} from "../../../lib/tauri";

/** 归档确认弹层的目标形态（所选 / 当前筛选）。 */
export interface ArchiveTarget {
  mode: "selected" | "filtered";
  count: number;
}

/** 归档失败摘要：archived > 0 为部分失败（警示色），否则全部失败（错误色）。 */
export interface ArchiveFailureSummary {
  archived: number;
  failed: number;
  firstPath: string;
  firstError: string;
}

function failureSummary(
  archived: number,
  failed: ArchiveFailure[],
): ArchiveFailureSummary | null {
  if (failed.length === 0) return null;
  return {
    archived,
    failed: failed.length,
    firstPath: failed[0].path,
    firstError: failed[0].error,
  };
}

/**
 * 归档动作状态机（批量勾选 + 单文件/所选/筛选归档 + 撤销）。
 *
 * 勾选与批量模式属于归档流程的一部分：归档成功后自动清空选择并退出批量。
 * 列表刷新由调用方注入（refreshList），本 hook 不持有查询状态。
 */
export function useFileArchive(
  items: FileRecord[],
  queryString: string,
  refreshList: () => void,
) {
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<{
    batchId: number;
    count: number;
  } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveFailure, setArchiveFailure] =
    useState<ArchiveFailureSummary | null>(null);

  const finishBatch = useCallback(
    (archived: number, failed: ArchiveFailure[], batchId: number | null | undefined) => {
      setArchiveNotice(archived > 0 ? { batchId: batchId ?? 0, count: archived } : null);
      setArchiveFailure(failureSummary(archived, failed));
      setSelected(new Set());
      setBatchMode(false);
      refreshList();
    },
    [refreshList],
  );

  const handleArchiveOne = useCallback(
    async (path: string) => {
      try {
        const outcome = await archiveFiles([path]);
        setArchiveNotice(
          outcome.archived > 0 ? { batchId: outcome.batchId ?? 0, count: outcome.archived } : null,
        );
        setArchiveFailure(failureSummary(outcome.archived, outcome.failed));
        refreshList();
        void logEvent("info", `ui: 归档文件 path=${path}`);
      } catch (err) {
        setArchiveError(String(err));
      }
    },
    [refreshList],
  );

  const handleArchiveSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const paths = items
      .filter((file) => selected.has(file.path))
      .map((file) => file.path);
    try {
      const outcome = await archiveFiles(paths);
      finishBatch(outcome.archived, outcome.failed, outcome.batchId);
      void logEvent("info", `ui: 归档所选 count=${outcome.archived}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  }, [items, selected, finishBatch]);

  const handleArchiveFiltered = useCallback(async () => {
    try {
      const outcome = await archiveFiltered(queryString);
      finishBatch(outcome.archived, outcome.failed, outcome.batchId);
      void logEvent("info", `ui: 归档筛选 count=${outcome.archived}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  }, [queryString, finishBatch]);

  const handleUndoArchive = useCallback(
    async (batchId: number) => {
      try {
        const outcome = await undoArchive(batchId);
        setArchiveNotice(null);
        setArchiveFailure(failureSummary(outcome.archived, outcome.failed));
        refreshList();
        void logEvent("info", `ui: 撤销归档 batch=${batchId}`);
      } catch (err) {
        setArchiveError(String(err));
      }
    },
    [refreshList],
  );

  const confirmArchive = useCallback(() => {
    if (!archiveTarget) return;
    if (archiveTarget.mode === "selected") {
      void handleArchiveSelected();
    } else {
      void handleArchiveFiltered();
    }
    setArchiveTarget(null);
  }, [archiveTarget, handleArchiveSelected, handleArchiveFiltered]);

  const toggleSelect = useCallback((path: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, []);

  const enterBatchMode = useCallback(() => setBatchMode(true), []);
  const openArchiveSelected = useCallback(
    () => setArchiveTarget({ mode: "selected", count: selected.size }),
    [selected.size],
  );
  const openArchiveFiltered = useCallback(
    (total: number, limit: number) =>
      // total=-1 为后端 COUNT 治理哨兵（筛选态不计总数），钳为 0 表示未知。
      setArchiveTarget({
        mode: "filtered",
        count: Math.max(0, Math.min(total, limit)),
      }),
    [],
  );
  const dismissNotice = useCallback(() => setArchiveNotice(null), []);
  const dismissError = useCallback(() => setArchiveError(null), []);
  const dismissFailure = useCallback(() => setArchiveFailure(null), []);
  const closeArchiveTarget = useCallback(() => setArchiveTarget(null), []);

  return {
    batchMode,
    selected,
    archiveTarget,
    archiveNotice,
    archiveError,
    archiveFailure,
    enterBatchMode,
    toggleSelect,
    cancelSelection,
    openArchiveSelected,
    openArchiveFiltered,
    closeArchiveTarget,
    confirmArchive,
    handleArchiveOne,
    handleUndoArchive,
    dismissNotice,
    dismissError,
    dismissFailure,
  };
}
