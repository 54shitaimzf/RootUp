import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";

/** 搜索语法帮助弹层：低学习成本，进阶用户可直达完整语法。 */
export function SyntaxHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
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
        <div className="absolute right-0 top-9 z-10 w-72 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="font-medium text-slate-700 dark:text-slate-200">
            {t("files.syntaxHelpTitle")}
          </div>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            {t("files.syntaxHelpHint")}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 rounded-md bg-slate-100 px-3 py-1 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
          >
            {t("close.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
