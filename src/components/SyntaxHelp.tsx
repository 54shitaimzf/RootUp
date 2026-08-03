import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";

interface SyntaxLine {
  key: string;
  desc: string;
}

/** 搜索语法帮助弹层：低学习成本，进阶用户可直达完整语法。 */
export function SyntaxHelp() {
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
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-label={t("files.syntaxHelpTitle")}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <HelpCircle className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-80 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-pop dark:border-slate-700 dark:bg-slate-900">
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
