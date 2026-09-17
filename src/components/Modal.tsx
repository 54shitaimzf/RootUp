import { useEffect, useRef, type ReactNode } from "react";
import { X } from "../theme/icons";
import { useTranslation } from "react-i18next";
import { IconButton } from "./IconButton";
import { isComposing } from "../lib/ime";

/** 进程内弹层注册表：Esc 只关最顶层。 */
const openPanels: (HTMLElement | null)[] = [];

/** 栈顶 = 文档顺序最靠后的弹窗面板（嵌套确认层是父面板的后代，天然在后）。 */
function topPanel(): HTMLElement | null {
  let top: HTMLElement | null = null;
  for (const panel of openPanels) {
    if (!panel) continue;
    if (
      !top ||
      (top.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)
    ) {
      top = panel;
    }
  }
  return top;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * 共享弹窗壳：遮罩点击 / Esc 关闭（栈顶优先）、滚动内容区、吸底按钮区。
 * 打开时焦点移入面板、Tab 在面板内循环、关闭后焦点还原到触发元素。
 * 视觉令牌与 CloseConfirmDialog 保持一致。
 */
export function Modal({
  open,
  title,
  onClose,
  width = "max-w-xl",
  contentHeight,
  children,
  footer,
  brandTitle = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  width?: string;
  contentHeight?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 设置类弹窗标题：品牌色 + 左侧等高竖线（与设置页分区标题同风格） */
  brandTitle?: boolean;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  // 关闭回调走 ref：避免内联箭头函数导致 effect 重跑打乱弹层栈顺序
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // effect 运行时面板已挂载：注册进全局表，仅文档顺序最顶层响应 Esc
    const panel = panelRef.current;
    const index = openPanels.push(panel);
    const restoreFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    // 焦点移入模态：内容自带 autoFocus 的控件优先，否则聚焦面板本身
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      if (event.key === "Escape") {
        if (topPanel() === panel) {
          onCloseRef.current();
        }
        return;
      }
      if (event.key === "Tab" && panel) {
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
          if (active === first || !panel.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !panel.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openPanels.splice(index - 1, 1);
      // 焦点还原到打开前的触发元素（已被移除时交给浏览器默认行为）
      if (
        restoreFocus &&
        document.contains(restoreFocus) &&
        !document.contains(panelRef.current)
      ) {
        restoreFocus.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`floating-panel flex max-h-[85vh] w-full ${width} flex-col focus:outline-none`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          {brandTitle ? (
            <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-700 dark:text-brand-300">
              <span
                aria-hidden="true"
                className="h-[1em] w-0.5 shrink-0 rounded-sm bg-brand-500"
              />
              {title}
            </h2>
          ) : (
            <h2 className="text-lg font-semibold text-strong">{title}</h2>
          )}
          <IconButton
            label={t("settings.dialogClose")}
            icon={X}
            tone="neutral"
            size="md"
            onClick={onClose}
          />
        </div>
        <div
          className={`min-h-0 overflow-y-auto px-5 py-4 ${
            contentHeight ? `flex-none ${contentHeight}` : "flex-1"
          }`}
        >
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
