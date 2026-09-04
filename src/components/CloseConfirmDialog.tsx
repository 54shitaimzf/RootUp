import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { APP_EVENTS } from "../lib/events";
import { hideToTray, quitApp } from "../lib/tauri";
import { Button } from "./Button";
import { Modal } from "./Modal";
import type { CloseAction } from "../lib/tauri";

/**
 * 关闭确认弹窗：
 * Rust 侧拦截关闭请求并广播 close-requested 事件，
 * 本组件据此弹出，由用户选择后台运行或退出。
 */
export function CloseConfirmDialog({
  onRemember,
}: {
  onRemember?: (action: CloseAction) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<null>(APP_EVENTS.closeRequested, () => setOpen(true))
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  if (!open) return null;

  const handleBackground = () => {
    if (remember) onRemember?.("background");
    void hideToTray();
  };

  const handleQuit = () => {
    if (remember) onRemember?.("quit");
    void quitApp();
  };

  return (
    <Modal
      open={open}
      title={t("close.title")}
      onClose={() => setOpen(false)}
      width="max-w-sm"
      footer={
        <>
          <Button
            variant="primary"
            size="md"
            onClick={handleBackground}
          >
            {t("close.background")}
          </Button>
          <Button variant="secondary" size="md" onClick={handleQuit}>
            {t("close.quit")}
          </Button>
          <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
            {t("close.cancel")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("close.description")}
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="size-3.5 accent-brand-600"
        />
        {t("close.remember")}
      </label>
    </Modal>
  );
}
