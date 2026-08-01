import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { hideToTray, quitApp } from "../lib/tauri";

/**
 * 关闭确认弹窗：
 * Rust 侧拦截关闭请求并广播 "close-requested"，
 * 本组件据此弹出，由用户选择后台运行或退出。
 */
export function CloseConfirmDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<null>("close-requested", () => setOpen(true))
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-96 rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{t("close.title")}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {t("close.description")}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t("close.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void hideToTray()}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t("close.background")}
          </button>
          <button
            type="button"
            onClick={() => void quitApp()}
            className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t("close.quit")}
          </button>
        </div>
      </div>
    </div>
  );
}
