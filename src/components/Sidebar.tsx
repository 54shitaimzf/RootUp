import {
  FolderKanban,
  FolderOpen,
  BookOpen,
  GraduationCap,
  Settings,
  Sprout,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { APP_NAME, APP_VERSION } from "../lib/constants";
import type { PageKey } from "../lib/nav";
import { Tooltip } from "./Tooltip";
import { useHelpCenter } from "./HelpCenter";

const NAV_ITEMS: { key: PageKey; icon: LucideIcon; labelKey: string }[] = [
  { key: "files", icon: FolderOpen, labelKey: "nav.files" },
  { key: "projects", icon: FolderKanban, labelKey: "nav.projects" },
  { key: "study", icon: GraduationCap, labelKey: "nav.study" },
  { key: "tools", icon: Wrench, labelKey: "nav.tools" },
  { key: "settings", icon: Settings, labelKey: "nav.settings" },
];

export function Sidebar({
  current,
  onNavigate,
}: {
  current: PageKey;
  onNavigate: (page: PageKey) => void;
}) {
  const { t } = useTranslation();
  const { openHelp } = useHelpCenter();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white shadow-card">
          <Sprout className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{APP_NAME}</div>
          <div
            className="truncate text-xs text-slate-500 dark:text-slate-400"
            title={t("app.tagline")}
          >
            {t("app.tagline")}
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ key, icon: Icon, labelKey }) => {
          const active = key === current;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-[var(--duration-fast)] ${
                active
                  ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-3 py-3">
        <Tooltip
          className="block w-full"
          content={`${t("help.title")} · ${t("help.cardSubtitleFull")}`}
        >
          <button
            type="button"
            onClick={() => openHelp("guide")}
            className="flex w-full items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] hover:border-brand-300 hover:bg-brand-50/60 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/10"
          >
            <BookOpen className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-300" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-600 dark:text-slate-300">
                {t("help.title")}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-500">
                {t("help.cardSubtitle")}
              </span>
            </span>
          </button>
        </Tooltip>
        <div className="mt-2 flex items-center justify-center gap-1">
          <Sprout className="size-3 text-brand-500/70" />
          <span className="font-mono text-[10px] tracking-wide text-slate-400 dark:text-slate-500">
            {APP_NAME} {APP_VERSION}
          </span>
        </div>
      </div>
    </aside>
  );
}
