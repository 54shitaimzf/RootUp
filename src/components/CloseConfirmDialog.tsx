import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { hideToTray, quitApp } from "../lib/tauri";
import { Button } from "./Button";
import { Modal } from "./Modal";

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
            onClick={() => void hideToTray()}
          >
            {t("close.background")}
          </Button>
          <Button variant="secondary" size="md" onClick={() => void quitApp()}>
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
    </Modal>
  );
}
