import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { isComposing } from "../lib/ime";
import { cleanPathInput } from "../lib/paths";
import {
  openDirectoryDialog,
  resolveDirTarget,
  type CommonDirEntry,
} from "../lib/tauri";

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * 目录添加器（监控目录 / 项目页共用）：文字输入 + 原生浏览 + 文件夹拖拽 +
 * 常用目录 chips + 实时错误提示；拖入文件时可选解析父目录。
 */
export function DirectoryAdder({
  placeholder,
  hint,
  addLabel,
  browseLabel,
  commonDirs,
  onAdd,
  allowFileParent = true,
  className = "",
}: {
  placeholder: string;
  hint: string;
  addLabel: string;
  browseLabel: string;
  commonDirs: CommonDirEntry[];
  /** 提交目录；返回错误文案（null 表示成功） */
  onAdd: (dir: string) => Promise<string | null>;
  /** 拖入文件时先解析父目录（默认 true） */
  allowFileParent?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const submit = useCallback(
    async (raw: string, resolveParent: boolean) => {
      let dir = cleanPathInput(raw);
      if (!dir) return;
      try {
        if (resolveParent) {
          dir = await resolveDirTarget(dir);
        }
        const failure = await onAdd(dir);
        if (failure) {
          setError(failure);
          return;
        }
        setValue("");
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    [onAdd],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "over") {
            setDragActive(true);
          } else if (event.payload.type === "leave") {
            setDragActive(false);
          } else if (event.payload.type === "drop") {
            setDragActive(false);
            const first = event.payload.paths[0];
            if (first) void submit(first, allowFileParent);
          }
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // 非 Tauri 环境（测试/浏览器预览）拖拽不可用，静默跳过
    }
    return () => {
      unlisten?.();
    };
  }, [submit, allowFileParent]);

  const handleBrowse = async () => {
    try {
      const dir = await openDirectoryDialog();
      if (dir) await submit(dir, false);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className={className}>
      <div
        className={`mt-2.5 rounded-lg border border-dashed px-3 py-2.5 transition-colors ${
          dragActive
            ? "border-brand-400 bg-brand-50/70 dark:border-brand-500/50 dark:bg-brand-500/10"
            : "border-slate-200 dark:border-slate-700"
        }`}
      >
        <div className="flex gap-2">
          <Input
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (isComposing(event)) return;
              if (event.key === "Enter") void submit(value, false);
            }}
            placeholder={placeholder}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="md"
            icon={FolderOpen}
            onClick={() => void handleBrowse()}
          >
            {browseLabel}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void submit(value, false)}
          >
            {addLabel}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
        {commonDirs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">{t("settings.commonDirs")}</span>
            {commonDirs.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                onClick={() => void submit(entry.path, false)}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300"
              >
                {t(`settings.commonDir${capitalize(entry.kind)}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
