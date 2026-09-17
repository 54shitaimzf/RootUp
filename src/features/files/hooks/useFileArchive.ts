import { useCallback, useRef, useState } from "react";
import {
  archiveFiles,
  archiveFiltered,
  archivePreflight,
  logEvent,
  undoArchive,
  type ArchiveFailure,
  type FileRecord,
  type PreflightReport,
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
  // 归档预检（0.8.8）：确认弹窗打开时取报告；软件冲突需风险确认后放行
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  // 预检拉取失败（区别于「统计中」）：弹窗不显示统计占位，确认仍可用
  const [preflightFailed, setPreflightFailed] = useState(false);
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  // 归档/撤销执行中：期间拒绝再次发起（工具条禁用 + 各入口早退），防连点重复批次。
  // 守卫读 ref 保持 handler 引用稳定（FileRow memo 链），state 只负责驱动 UI 禁用。
  const archivingRef = useRef(false);
  const [archiving, setArchiving] = useState(false);
  const beginArchive = useCallback(() => {
    if (archivingRef.current) return false;
    archivingRef.current = true;
    setArchiving(true);
    return true;
  }, []);
  const endArchive = useCallback(() => {
    archivingRef.current = false;
    setArchiving(false);
  }, []);

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
      if (!beginArchive()) return;
      try {
        const outcome = await archiveFiles([path], false);
        setArchiveNotice(
          outcome.archived > 0 ? { batchId: outcome.batchId ?? 0, count: outcome.archived } : null,
        );
        setArchiveFailure(failureSummary(outcome.archived, outcome.failed));
        refreshList();
        void logEvent("info", `ui: 归档文件 path=${path}`);
      } catch (err) {
        setArchiveError(String(err));
      } finally {
        endArchive();
      }
    },
    [refreshList],
  );

  const handleArchiveSelected = useCallback(async () => {
    if (selected.size === 0) return;
    if (!beginArchive()) return;
    const paths = items
      .filter((file) => selected.has(file.path))
      .map((file) => file.path);
    try {
      const outcome = await archiveFiles(paths, riskConfirmed && (preflight?.softwareUnits.length ?? 0) > 0);
      finishBatch(outcome.archived, outcome.failed, outcome.batchId);
      void logEvent("info", `ui: 归档所选 count=${outcome.archived}`);
    } catch (err) {
      setArchiveError(String(err));
    } finally {
      endArchive();
    }
  }, [items, selected, finishBatch, riskConfirmed, preflight]);

  const handleArchiveFiltered = useCallback(async () => {
    if (!beginArchive()) return;
    try {
      const outcome = await archiveFiltered(queryString);
      finishBatch(outcome.archived, outcome.failed, outcome.batchId);
      void logEvent("info", `ui: 归档筛选 count=${outcome.archived}`);
    } catch (err) {
      setArchiveError(String(err));
    } finally {
      endArchive();
    }
  }, [queryString, finishBatch]);

  const handleUndoArchive = useCallback(
    async (batchId: number) => {
      if (!beginArchive()) return;
      try {
        const outcome = await undoArchive(batchId);
        setArchiveNotice(null);
        setArchiveFailure(failureSummary(outcome.archived, outcome.failed));
        refreshList();
        void logEvent("info", `ui: 撤销归档 batch=${batchId}`);
      } catch (err) {
        setArchiveError(String(err));
      } finally {
        endArchive();
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
  const openArchiveSelected = useCallback(() => {
    setRiskConfirmed(false);
    setPreflight(null);
    setPreflightFailed(false);
    setArchiveTarget({ mode: "selected", count: selected.size });
    const paths = items
      .filter((file) => selected.has(file.path))
      .map((file) => file.path);
    archivePreflight(paths)
      .then(setPreflight)
      .catch(() => setPreflightFailed(true));
  }, [items, selected.size]);
  const openArchiveFiltered = useCallback(
    (total: number, limit: number) => {
      // total=-1 为后端 COUNT 治理哨兵（筛选态不计总数），钳为 0 表示未知。
      setRiskConfirmed(false);
      setPreflight(null);
      setPreflightFailed(false);
      setArchiveTarget({
        mode: "filtered",
        count: Math.max(0, Math.min(total, limit)),
      });
    },
    [],
  );
  const dismissNotice = useCallback(() => setArchiveNotice(null), []);
  const dismissError = useCallback(() => setArchiveError(null), []);
  const dismissFailure = useCallback(() => setArchiveFailure(null), []);
  const closeArchiveTarget = useCallback(() => {
    setArchiveTarget(null);
    setPreflight(null);
    setRiskConfirmed(false);
  }, []);

  return {
    batchMode,
    selected,
    archiveTarget,
    archiveNotice,
    archiveError,
    archiveFailure,
    preflight,
    preflightFailed,
    riskConfirmed,
    archiving,
    setRiskConfirmed,
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
