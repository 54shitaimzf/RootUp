import { useTranslation } from "react-i18next";

export interface SyntaxLine {
  key: string;
  desc: string;
}

/** 搜索语法表（SyntaxHelp 与帮助中心共用，单一来源为 i18n syntaxHelpList）。 */
export function SyntaxTable() {
  const { t } = useTranslation();
  const lines = t("files.syntaxHelpList", {
    returnObjects: true,
  }) as SyntaxLine[];
  return (
    <div className="space-y-1.5">
      {lines.map((line) => (
        <div
          key={line.key}
          className="rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800"
        >
          <div className="font-mono text-[11px] font-semibold text-brand-700 dark:text-brand-300">
            {line.key}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {line.desc}
          </div>
        </div>
      ))}
    </div>
  );
}
