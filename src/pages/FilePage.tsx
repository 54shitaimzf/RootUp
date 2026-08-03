import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { FilterBar } from "../components/FilterBar";
import { SearchAutocomplete } from "../components/SearchAutocomplete";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import type { PageKey } from "../lib/nav";
import { useFiles } from "../hooks/useFiles";
import { useFilterHabits } from "../hooks/useFilterHabits";
import type { ScanController } from "../hooks/useScan";
import {
  fileStateMeta,
  buildQuery,
  FILTER_STATE_OPTIONS,
  formatFileSize,
  formatTimestamp,
  parseLabels,
} from "../lib/fileUtils";
import {
  KEYWORD_PREFIXES,
  type Suggestion,
  type TagValue,
} from "../lib/autocomplete";
import {
  listCategories,
  listLabels,
  listWatchedDirs,
  logEvent,
} from "../lib/tauri";

const PAGE_SIZE = 50;

const KEYWORD_DISPLAY_KEY: Record<string, string> = {
  "type:": "files.acKeywordType",
  "label:": "files.acKeywordLabel",
  "state:": "files.acKeywordState",
  "size:": "files.acKeywordSize",
  "before:": "files.acKeywordBefore",
  "after:": "files.acKeywordAfter",
};

export function FilePage({
  onNavigate,
  scan,
}: {
  onNavigate: (page: PageKey) => void;
  scan: ScanController;
}) {
  const { t } = useTranslation();
  const { habits, touch } = useFilterHabits();
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

  const autocompleteCandidates = useMemo<Suggestion[]>(() => {
    const stateLabel = (state: string) =>
      t(`filter.state${state[0].toUpperCase()}${state.slice(1)}`);
    const keywords = KEYWORD_PREFIXES.map((prefix) => ({
      kind: "keyword" as const,
      key: `keyword:${prefix}`,
      raw: prefix,
      token: prefix,
      display: t(KEYWORD_DISPLAY_KEY[prefix]),
    }));
    return [
      ...keywords,
      ...categories.map((category) => ({
        kind: "category" as const,
        key: `category:${category}`,
        raw: category,
        token: `type:${category}`,
        display: t(`filter.${category}`),
      })),
      ...FILTER_STATE_OPTIONS.map((state) => ({
        kind: "state" as const,
        key: `state:${state}`,
        raw: state,
        token: `state:${state}`,
        display: stateLabel(state),
      })),
      ...availableLabels.map((label) => ({
        kind: "label" as const,
        key: `label:${label}`,
        raw: label,
        token: `label:${label}`,
        display: label,
      })),
    ];
  }, [categories, availableLabels, t]);

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

      <SearchAutocomplete
        text={query}
        types={types}
        states={states}
        labels={labels}
        candidates={autocompleteCandidates}
        habits={habits}
        onTextChange={(value) => {
          setQuery(value);
          setOffset(0);
        }}
        onTagsChange={(tags) => {
          setTypes(tags.types);
          setStates(tags.states);
          setLabels(tags.labels);
          setOffset(0);
        }}
        onInsert={(suggestion) =>
          void logEvent(
            "info",
            `autocomplete: 插入 kind=${suggestion.kind} key=${suggestion.key} token=${suggestion.token}`,
          )
        }
        onTagAdd={(tag: TagValue) =>
          void logEvent(
            "info",
            `autocomplete: 标签 添加 kind=${tag.kind} key=${tag.value}`,
          )
        }
        onTagRemove={(tag: TagValue) =>
          void logEvent(
            "info",
            `autocomplete: 标签 删除 kind=${tag.kind} key=${tag.value}`,
          )
        }
      />

      <FilterBar
        habits={habits}
        onHabitUsed={touch}
        categories={categories}
        labels={availableLabels}
        selectedTypes={types}
        selectedLabels={labels}
        onTypesChange={(value) => {
          setTypes(value);
          setOffset(0);
        }}
        onLabelsChange={(value) => {
          setLabels(value);
          setOffset(0);
        }}
      />

      {scanning && (
        <Banner variant="brand" className="mt-4">
          <div>
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
          <Button variant="primary" size="sm" onClick={() => scan.cancel()}>
            {t("files.cancelScan")}
          </Button>
        </Banner>
      )}

      {scan.lastError && (
        <Banner variant="error" className="mt-4" onClose={scan.clearError}>
          <span className="block truncate">{scan.lastError}</span>
        </Banner>
      )}

      {stale && (
        <Banner
          variant="warn"
          padding="sm"
          className="mt-4"
          actions={
            <Button variant="amber" size="sm" onClick={handleRefresh}>
              {t("files.refresh")}
            </Button>
          }
        >
          <span className="min-w-0 flex-1">{t("files.newChanges")}</span>
        </Banner>
      )}

      <div className="mt-4 min-h-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        {loading && items.length > 0 && (
          <div className="h-0.5 animate-pulse bg-brand-500/70" />
        )}
        {loading && items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("files.loading")}
          </div>
        ) : watchedCount === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            <p>{t("files.empty")}</p>
            <Button
              variant="primary"
              size="md"
              className="mt-3"
              onClick={() => onNavigate("settings")}
            >
              {t("files.goSettings")}
            </Button>
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                >
                  {t("files.loadMore")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
