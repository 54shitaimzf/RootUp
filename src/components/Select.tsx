import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isComposing } from "../lib/ime";
import { dropdownPosition } from "../lib/dropdown";

export interface SelectOption {
  value: string;
  label: string;
  /** 选项/触发按钮左侧图标（无素材则不传） */
  icon?: ReactNode;
  /** 选项色点类名（如 LABEL_COLORS[key].dot） */
  dotClass?: string;
  /** 描述副行（如学期日期范围） */
  description?: string;
  disabled?: boolean;
}

/**
 * 自定义下拉（组合框模式）：触发按钮 + portal 弹层，替代原生 select。
 * 支持鼠标、键盘（↑/↓/Home/End/Enter/Tab）、输入过滤（searchable）、
 * Esc 先清词再关闭、外点关闭；固定定位并做视口钳制与底部翻转。
 */
export function Select({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  disabled = false,
  searchable = true,
  placeholder,
  size = "sm",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  searchable?: boolean;
  placeholder?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!searchable || needle === "") return options;
    return options.filter((option) =>
      `${option.label} ${option.description ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [options, query, searchable]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(
      Math.max(0, options.findIndex((option) => option.value === value)),
    );
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition(
        dropdownPosition(
          {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
          },
          { width: window.innerWidth, height: window.innerHeight },
          240,
        ),
      );
    }
    if (searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    // 仅在打开瞬间初始化一次，避免父级重渲染时重置过滤词
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      if (event.key === "Escape") {
        if (searchable && query !== "") {
          setQuery("");
        } else {
          setOpen(false);
          triggerRef.current?.focus();
        }
        return;
      }
      if (event.key === "Tab") {
        setOpen(false);
        return;
      }
      if (filtered.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setHighlight(
          (current) => (current + delta + filtered.length) % filtered.length,
        );
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setHighlight(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setHighlight(filtered.length - 1);
        return;
      }
      if (event.key === "Enter") {
        const option = filtered[highlight];
        if (option) {
          event.preventDefault();
          select(option);
        }
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, query, filtered, highlight, searchable, value]);

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (isComposing(event)) return;
    if (
      !open &&
      (event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown" ||
        event.key === "ArrowUp")
    ) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const sizeClass = size === "md" ? "py-2 text-sm" : "py-1.5 text-xs";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className={`flex w-full items-center justify-between gap-1.5 rounded-md border bg-slate-50 px-2.5 outline-none transition-colors focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 ${sizeClass} ${
          open
            ? "border-brand-500"
            : "border-slate-200 dark:border-slate-700"
        } ${className}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selected?.icon && (
            <span className="shrink-0 text-muted">{selected.icon}</span>
          )}
          {selected?.dotClass && (
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${selected.dotClass}`}
            />
          )}
          <span className="truncate font-medium text-strong">
            {selected?.label ?? placeholder ?? "—"}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            aria-label={ariaLabel}
            className="floating-panel pop-in fixed z-[60] flex flex-col p-1.5"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            {searchable && (
              <div className="mb-1.5 shrink-0 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  placeholder={t("dropdown.searchPlaceholder")}
                  aria-label={t("dropdown.searchPlaceholder")}
                  className="w-full rounded-md border border-transparent bg-slate-100/70 px-2 py-1 text-xs outline-none transition-colors focus:border-brand-500 dark:bg-slate-800"
                />
              </div>
            )}
            <div className="min-h-0 overflow-y-auto">
              {filtered.length === 0 ? (
                <div
                  role="option"
                  aria-disabled="true"
                  className="px-2 py-2 text-xs text-muted"
                >
                  {t("dropdown.noResults")}
                </div>
              ) : (
                filtered.map((option, index) => {
                  const selectedOption = option.value === value;
                  const active = index === highlight;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selectedOption}
                      disabled={option.disabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(option)}
                      onMouseEnter={() => setHighlight(index)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        selectedOption
                          ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : active
                            ? "bg-slate-100 text-strong dark:bg-slate-800"
                            : "text-secondary hover:bg-slate-100 dark:hover:bg-slate-800"
                      } ${option.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      {option.icon && (
                        <span className="shrink-0 text-muted">{option.icon}</span>
                      )}
                      {option.dotClass && (
                        <span
                          aria-hidden="true"
                          className={`size-2 shrink-0 rounded-full ${option.dotClass}`}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={option.label}>
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="block truncate text-[10px] text-muted">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {selectedOption && (
                        <Check aria-hidden="true" className="size-3.5 shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
