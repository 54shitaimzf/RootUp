import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { mergeFiles } from "../lib/fileUtils";
import { listFiles, logEvent, type FileRecord } from "../lib/tauri";

/** 文件索引列表：初始加载 + 监听 "files-changed" 实时合并。 */
export function useFiles() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listFiles()
      .then(setFiles)
      .catch((err) => {
        void logEvent("error", `加载文件索引失败: ${String(err)}`);
      })
      .finally(() => setLoading(false));

    listen<FileRecord[]>("files-changed", (event) => {
      setFiles((prev) => mergeFiles(prev, event.payload));
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

  return { files, loading };
}
