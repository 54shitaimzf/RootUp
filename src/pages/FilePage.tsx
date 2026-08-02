import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { FilterBar } from "../components/FilterBar";
import { SyntaxHelp } from "../components/SyntaxHelp";
import type { PageKey } from "../components/Sidebar";
import { useFiles } from "../hooks/useFiles";
import type { ScanController } from "../hooks/useScan";
import {
  fileStateMeta,
  buildQuery,
  formatFileSize,
  formatTimestamp,
  parseLabels,
} from "../lib/fileUtils";
import { listCategories, listLabels, listWatchedDirs } from "../lib/tauri";

const PAGE_SIZE = 50;

export function FilePage({
  onNavigate,
  scan,
}: {
  onNavigate: (page: PageKey) => void;
  scan: ScanController;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [watchedCount, setWatchedCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    listLabels()
      .then(setAvailableLabels)
      .catch(() => setAvailableLabels([]));
    listWatchedDirs()
      .then((dirs) => setWatchedCount(dirs.length))
      .catch(() => setWatchedCount(0));
  }, []);

  const queryString = useMemo(
    () => buildQuery({ text: debouncedQuery, types, states, labels }),
    [debouncedQuery, types, states, labels],
  );

  const { items, total, loading, stale } = useFiles(
    queryString,
    PAGE_SIZE,
    offset,
    refreshKey,
  );

  const scanning = scan.status?.active ?? false;
  const scanDir = scan.status?.dir ?? "";
  const scanProcessed = scan.status?.processed ?? 0;
  const scanDiscovered = scan.status?.discovered ?? 0;

  const handleRefresh = () => {
    setOffset(0);
    setRefreshKey((key) => key + 1);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">{t("pages.files.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t("pages.files.description")}
      </p>

      <div className="mt-6 flex items-center gap-1">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
          placeholder={t("files.searchPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-card outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <SyntaxHelp />
      </div>

      <FilterBar
        categories={categories}
        labels={availableLabels}
        selectedTypes={types}
        selectedStates={states}
        selectedLabels={labels}
        onTypesChange={(value) => {
          setTypes(value);
          setOffset(0);
        }}
        onStatesChange={(value) => {
          setStates(value);
          setOffset(0);
        }}
        onLabelsChange={(value) => {
          setLabels(value);
          setOffset(0);
        }}
      />

      {scanning && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm dark:border-brand-500/25 dark:bg-brand-500/10">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-brand-800 dark:text-brand-300">
              {t("files.scanning", { dir: scanDir })}
            </div>
            <div className="text-xs text-brand-700/80 dark:text-brand-400/80">
              {t("files.scanProgress", {
                processed: scanProcessed,
                discovered: scanDiscovered,
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => scan.cancel()}
            className="shrink-0 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-800"
          >
            {t("files.cancelScan")}
          </button>
        </div>
      )}

      {scan.lastError && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-400">
          <span className="min-w-0 flex-1 truncate">{scan.lastError}</span>
          <button
            type="button"
            onClick={scan.clearError}
            aria-label={t("close.cancel")}
            className="shrink-0 rounded p-1 hover:bg-red-100 dark:hover:bg-red-500/20"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {stale && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
          <span className="min-w-0 flex-1">{t("files.newChanges")}</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            {t("files.refresh")}
          </button>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("files.loading")}
          </div>
        ) : watchedCount === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            <p>{t("files.empty")}</p>
            <button
              type="button"
              onClick={() => onNavigate("settings")}
              className="mt-3 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-800"
            >
              {t("files.goSettings")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("files.noResults")}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((file) => {
                const meta = fileStateMeta(file.state);
                const fileLabels = parseLabels(file.labels);
                return (
                  <li
                    key={file.path}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm"
                    title={file.path}
                  >
                    <FileTypeIcon
                      category={fileLabels[0] ?? "other"}
                      title={fileLabels[0] ?? "other"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800 dark:text-slate-100">
                        {file.name}
                      </span>
                      <span className="block truncate text-xs text-slate-400 dark:text-slate-500">
                        {file.path}
                      </span>
                    </span>
                    {fileLabels.length > 0 && (
                      <span className="hidden shrink-0 gap-1 md:flex">
                        {fileLabels.map((label) => (
                          <span
                            key={label}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {t(`filter.${label}`, label)}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="hidden w-20 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500 sm:block">
                      {file.file_type || "—"}
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500 sm:block">
                      {formatFileSize(file.size)}
                    </span>
                    <span className="hidden w-28 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500 md:block">
                      {formatTimestamp(file.modified)}
                    </span>
                    <span className="flex w-20 shrink-0 items-center justify-end gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className={`size-1.5 rounded-full ${meta.dotClass}`} />
                      {t(meta.labelKey)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <span>
                {t("files.countInfo", {
                  shown: items.length,
                  total,
                })}
              </span>
              {items.length < total && (
                <button
                  type="button"
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                  className="rounded-md bg-slate-100 px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t("files.loadMore")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
