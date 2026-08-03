import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { IconButton } from "./IconButton";

interface SyntaxLine {
  key: string;
  desc: string;
}

/**
 * 搜索语法帮助弹层：低学习成本，进阶用户可直达完整语法。
 * 触发按钮默认内嵌于搜索栏（调用方传定位类包裹进输入框）；
 * 浮窗从按钮下方展开，z-40 高于补全下拉。
 */
export function SyntaxHelp({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lines = t("files.syntaxHelpList", {
    returnObjects: true,
  }) as SyntaxLine[];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={className || "relative"}>
      <IconButton
        label={t("files.syntaxHelpTitle")}
        icon={HelpCircle}
        tone="neutral"
        size="md"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      />
      {open && (
        <div className="floating-panel pop-in absolute right-0 top-full z-40 mt-2 w-80 p-4 text-xs">
          <div className="font-medium text-slate-700 dark:text-slate-200">
            {t("files.syntaxHelpTitle")}
          </div>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            {t("files.syntaxHelpIntro")}
          </p>
          <div className="mt-3 space-y-1.5">
            {lines.map((line) => (
              <div
                key={line.key}
                className="rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800"
              >
                <div className="font-mono text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                  {line.key}
                </div>
                <div className="mt-0.5 leading-relaxed text-slate-500 dark:text-slate-400">
                  {line.desc}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-slate-100 pt-2 text-slate-400 dark:border-slate-800 dark:text-slate-500">
            {t("files.syntaxHelpNote")}
          </p>
        </div>
      )}
    </div>
  );
}
