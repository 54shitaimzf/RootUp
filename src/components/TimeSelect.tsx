import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Clock, Minus, Plus } from "lucide-react";
import { isComposing } from "../lib/ime";
import { minToTime, snapToFiveMinutes, timeToMin } from "../lib/study";
import type { InputSize } from "./Input";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);

/**
 * 自定义时间选择：5 分钟粒度，弹出层 portal 到 body 避免弹窗滚动裁剪。
 * 支持 ±5 分钟快捷、方向键微调、Esc/外部点击关闭，深色主题自适应。
 */
export function TimeSelect({
  value,
  onChange,
  id,
  size = "sm",
  invalid = false,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  size?: InputSize;
  invalid?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pendingHour, setPendingHour] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const baseMin = timeToMin(value) ?? 480;

  useEffect(() => {
    if (open) setPendingHour(Math.floor(baseMin / 60));
  }, [open, baseMin]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = snapToFiveMinutes(
          baseMin + (event.key === "ArrowUp" ? 5 : -5),
        );
        onChange(minToTime(next));
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, baseMin, onChange]);

  const commit = (min: number) => {
    onChange(minToTime(snapToFiveMinutes(min)));
    setOpen(false);
    buttonRef.current?.focus();
  };

  const rect = buttonRef.current?.getBoundingClientRect();
  const popoverStyle = rect
    ? { top: rect.bottom + 4, left: rect.left }
    : undefined;
  const sizeClass = size === "md" ? "py-2 text-sm" : "py-1.5 text-xs";

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-28 items-center justify-between gap-1 rounded-md border bg-slate-50 px-2.5 outline-none transition-colors focus:border-brand-500 dark:bg-slate-800 ${sizeClass} ${
          invalid
            ? "border-red-400 dark:border-red-500/50"
            : "border-slate-200 dark:border-slate-700"
        } ${className}`}
      >
        <span className="flex items-center gap-1.5">
          <Clock aria-hidden className="size-3.5 text-muted" />
          <span className="font-medium tabular-nums text-strong">
            {value || "—"}
          </span>
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-muted" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            aria-label={ariaLabel}
            className="floating-panel pop-in fixed z-[60] w-60 p-2"
            style={popoverStyle}
          >
            <div className="flex items-center justify-between gap-1 border-b border-slate-100 pb-1.5 dark:border-slate-800">
              <button
                type="button"
                aria-label="-5"
                onClick={() => commit(baseMin - 5)}
                className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] font-medium text-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Minus aria-hidden className="size-3" />5
              </button>
              <span className="text-xs font-medium tabular-nums text-strong">
                {value || "—"}
              </span>
              <button
                type="button"
                aria-label="+5"
                onClick={() => commit(baseMin + 5)}
                className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] font-medium text-secondary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                5<Plus aria-hidden className="size-3" />
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <div
                data-testid="time-hours"
                className="max-h-44 flex-1 overflow-y-auto pr-0.5"
              >
                {HOURS.map((hour) => {
                  const selected = hour === pendingHour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setPendingHour(hour)}
                      className={`block w-full rounded-md px-2 py-1 text-left text-xs tabular-nums transition-colors ${
                        selected
                          ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : "text-secondary hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {String(hour).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
              <div
                data-testid="time-minutes"
                className="max-h-44 flex-1 overflow-y-auto pr-0.5"
              >
                {MINUTES.map((minute) => {
                  const selected =
                    pendingHour !== null &&
                    pendingHour * 60 + minute === baseMin;
                  return (
                    <button
                      key={minute}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        const hour = pendingHour ?? Math.floor(baseMin / 60);
                        commit(hour * 60 + minute);
                      }}
                      className={`block w-full rounded-md px-2 py-1 text-left text-xs tabular-nums transition-colors ${
                        selected
                          ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : "text-secondary hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {String(minute).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
