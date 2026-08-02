import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import type { ScanController } from "../hooks/useScan";
import {
  addWatchedDir,
  getLogDir,
  listWatchedDirs,
  removeWatchedDir,
  type Language,
  type ThemeMode,
} from "../lib/tauri";
import { useTheme } from "../theme/ThemeProvider";

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

const LANGUAGE_OPTIONS: { value: Language; labelKey: string }[] = [
  { value: "zh-CN", labelKey: "settings.languageZh" },
  { value: "en", labelKey: "settings.languageEn" },
];

export function SettingsPage({ scan }: { scan: ScanController }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { settings, update } = useSettings();
  const language = settings?.language ?? "zh-CN";
  const [watchedDirs, setWatchedDirs] = useState<string[]>([]);
  const [newDir, setNewDir] = useState("");
  const [dirError, setDirError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    listWatchedDirs()
      .then(setWatchedDirs)
      .catch(() => setWatchedDirs([]));
    getLogDir()
      .then(setLogDir)
      .catch(() => setLogDir(null));
  }, []);

  const handleAddDir = async () => {
    const dir = newDir.trim();
    if (!dir) return;
    try {
      const outcome = await addWatchedDir(dir);
      setWatchedDirs((prev) => [...new Set([...prev, dir])]);
      setNewDir("");
      setDirError(null);
      setNotice(outcome.message ?? t("settings.dirAdded"));
    } catch (err) {
      setDirError(String(err));
      setNotice(null);
    }
  };

  const handleRemoveDir = async (dir: string) => {
    try {
      await removeWatchedDir(dir);
      setWatchedDirs((prev) => prev.filter((d) => d !== dir));
      setDirError(null);
    } catch (err) {
      setDirError(String(err));
    }
  };

  const handleRescanAll = () => {
    scan.startScanAll();
    setNotice(t("settings.scanStarted"));
  };

  const handleCopyLogDir = async () => {
    if (!logDir) return;
    try {
      await navigator.clipboard.writeText(logDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时保持静默
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("pages.settings.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t("pages.settings.description")}
      </p>

      {scan.status?.active && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
          {t("settings.scanningNow", { dir: scan.status.dir ?? "" })}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
          {notice}
        </div>
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("settings.watchedDirs")}</h2>
          <button
            type="button"
            onClick={handleRescanAll}
            className="flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <RefreshCw className="size-3.5" />
            {t("settings.rescanAll")}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("settings.watchedDirsDesc")}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newDir}
            onChange={(event) => setNewDir(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAddDir();
            }}
            placeholder={t("settings.dirPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={() => void handleAddDir()}
            className="shrink-0 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-800"
          >
            {t("settings.addDir")}
          </button>
        </div>
        {dirError && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400">
            {dirError}
          </p>
        )}
        <ul className="mt-3 space-y-1">
          {watchedDirs.length === 0 ? (
            <li className="text-xs text-slate-400 dark:text-slate-500">
              {t("settings.dirEmpty")}
            </li>
          ) : (
            watchedDirs.map((dir) => (
              <li
                key={dir}
                className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800"
              >
                <span className="min-w-0 flex-1 truncate">{dir}</span>
                <button
                  type="button"
                  onClick={() => void handleRemoveDir(dir)}
                  className="shrink-0 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-500"
                >
                  {t("settings.remove")}
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-medium">{t("settings.theme")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={`rounded-md px-4 py-2 text-sm transition-colors ${
                theme === value
                  ? "bg-brand-700 font-medium text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-medium">{t("settings.language")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => update({ language: value })}
              className={`rounded-md px-4 py-2 text-sm transition-colors ${
                language === value
                  ? "bg-brand-700 font-medium text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-medium">{t("settings.logDir")}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("settings.logDirHint")}
        </p>
        {logDir && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">
              {logDir}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyLogDir()}
              aria-label={t("settings.copyPath")}
              className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
            >
              {copied ? <Check className="size-4 text-brand-600" /> : <Copy className="size-4" />}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
