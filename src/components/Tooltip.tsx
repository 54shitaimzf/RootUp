import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 品牌悬浮提示：hover/聚焦延迟显示，Esc 或移出关闭；
 * 通过 portal 渲染到 body，避免被滚动容器裁剪；reduced-motion 由全局降级处理。
 */
export function Tooltip({
  content,
  children,
  position = "top",
  delay = 300,
}: {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom";
  delay?: number;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);
  const visibleRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    if (!content.trim()) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const el = hostRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({
        top: position === "top" ? r.top - 8 : r.bottom + 8,
        left: r.left + r.width / 2,
      });
      visibleRef.current = true;
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    visibleRef.current = false;
    setVisible(false);
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <span
      ref={hostRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible &&
        rect &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[70] rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-pop dark:bg-slate-700 dark:text-slate-100"
            style={{
              top: rect.top,
              left: rect.left,
              transform:
                position === "top"
                  ? "translate(-50%, -100%)"
                  : "translate(-50%, 0)",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
