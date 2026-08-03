import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  cancelScan,
  getScanStatus,
  logEvent,
  scanAll,
  type ScanEventPayload,
  type ScanStatus,
  type ScanSummary,
} from "../lib/tauri";

/** 扫描控制器：App 级实例化一次，文件页/设置页共享。 */
export function useScan() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [lastSummary, setLastSummary] = useState<ScanSummary | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    getScanStatus()
      .then(setStatus)
      .catch(() => setStatus(null));

    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;

    listen<ScanEventPayload>("scan-progress", (event) => {
      if (event.payload.type !== "progress") return;
      const p = event.payload.progress;
      setStatus((prev) => ({
        active: true,
        dir: p.dir,
        discovered: p.discovered,
        processed: p.processed,
        ignored: p.ignored,
        errors: p.errors,
        queued: prev?.queued ?? 0,
      }));
    })
      .then((fn) => {
        unlistenProgress = fn;
      })
      .catch((err) => {
        void logEvent("warn", `监听 scan-progress 失败: ${String(err)}`);
      });

    listen<ScanEventPayload>("scan-finished", (event) => {
      const payload = event.payload;
      if (payload.type === "finished" || payload.type === "cancelled") {
        setLastSummary(payload.summary);
        setStatus(() => ({
          active: false,
          dir: null,
          discovered: payload.summary.discovered,
          processed: payload.summary.added + payload.summary.updated,
          ignored: payload.summary.ignored,
          errors: payload.summary.errors,
          queued: 0,
        }));
      } else if (payload.type === "failed") {
        setLastError(payload.error);
        setStatus((prev) => ({
          active: false,
          dir: null,
          discovered: prev?.discovered ?? 0,
          processed: prev?.processed ?? 0,
          ignored: prev?.ignored ?? 0,
          errors: (prev?.errors ?? 0) + 1,
          queued: 0,
        }));
      }
    })
      .then((fn) => {
        unlistenFinished = fn;
      })
      .catch((err) => {
        void logEvent("warn", `监听 scan-finished 失败: ${String(err)}`);
      });

    return () => {
      unlistenProgress?.();
      unlistenFinished?.();
    };
  }, []);

  const startScanAll = () => {
    scanAll()
      .then(() => setLastError(null))
      .catch((err) => setLastError(String(err)));
  };

  const cancel = () => {
    void logEvent("info", "ui: 取消扫描");
    cancelScan().catch((err) => {
      void logEvent("warn", `取消扫描失败: ${String(err)}`);
    });
  };

  return {
    status,
    lastSummary,
    lastError,
    startScanAll,
    cancel,
    clearError: () => setLastError(null),
  };
}

export type ScanController = ReturnType<typeof useScan>;
