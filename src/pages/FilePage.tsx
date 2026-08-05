import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, CheckSquare, Code2, ExternalLink, LocateFixed } from "lucide-react";
import { CATEGORY_ICON, FileTypeIcon } from "../components/FileTypeIcon";
import { FilterBar } from "../components/FilterBar";
import { SearchAutocomplete } from "../components/SearchAutocomplete";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { PageHeader } from "../components/PageHeader";
import { useSettings } from "../hooks/useSettings";
import type { PageKey } from "../lib/nav";
import { useFiles } from "../hooks/useFiles";
import { useFilterHabits } from "../hooks/useFilterHabits";
import { useLabelDefs } from "../hooks/useLabelDefs";
import type { ScanController } from "../hooks/useScan";
import { LABEL_COLORS, labelColorKey } from "../lib/labelDefs";
import { buildCourseLabelDefs } from "../lib/studyStore";
import { getStudyData } from "../lib/tauri";
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
  archiveFiles,
  archiveFiltered,
  listCategories,
  listLabels,
  listWatchedDirs,
  logEvent,
  openFile,
  openProjectFromFile,
  revealInExplorer,
  undoArchive,
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
  const { settings } = useSettings();
  const { habits, touch } = useFilterHabits();
  const labelDefs = useLabelDefs();
  const [courseLabelDefs, setCourseLabelDefs] = useState<
    Record<string, { key: string; name: string; icon: string; color: string }>
  >({});
  const archiveRoot = settings?.archive_root?.trim() ?? "";
  const autoArchive = settings?.auto_archive ?? false;
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
  const [showLoadingBar, setShowLoadingBar] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveTarget, setArchiveTarget] = useState<{
    mode: "selected" | "filtered";
    count: number;
  } | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<{
    batchId: number;
    count: number;
  } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [autoHintHidden, setAutoHintHidden] = useState(false);

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

  useEffect(() => {
    getStudyData()
      .then((data) => setCourseLabelDefs(buildCourseLabelDefs(data)))
      .catch(() => setCourseLabelDefs({}));
  }, []);

  const mergedLabelDefs = useMemo(
    () => ({ ...labelDefs, ...courseLabelDefs }),
    [labelDefs, courseLabelDefs],
  );

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
        display: mergedLabelDefs[label]?.name ?? label,
      })),
    ];
  }, [categories, availableLabels, mergedLabelDefs, t]);

  const { items, total, loading, stale } = useFiles(
    queryString,
    PAGE_SIZE,
    offset,
    refreshKey,
  );

  // 刷新指示延迟出现：150ms 内完成的查询不显示，避免正常操作时可见
  useEffect(() => {
    if (!loading) {
      setShowLoadingBar(false);
      return;
    }
    const timer = window.setTimeout(() => setShowLoadingBar(true), 150);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const scanning = scan.status?.active ?? false;
  const scanDir = scan.status?.dir ?? "";
  const scanProcessed = scan.status?.processed ?? 0;
  const scanDiscovered = scan.status?.discovered ?? 0;

  const handleRefresh = () => {
    setOffset(0);
    setRefreshKey((key) => key + 1);
    void logEvent("info", "ui: 刷新");
  };

  const handleOpenFile = async (path: string) => {
    try {
      await openFile(path);
      setActionError(null);
      void logEvent("info", `ui: 打开文件 path=${path}`);
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleRevealFile = async (path: string) => {
    try {
      await revealInExplorer(path);
      setActionError(null);
      void logEvent("info", `ui: 定位文件 path=${path}`);
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleIdeOpenFile = async (path: string) => {
    try {
      const outcome = await openProjectFromFile(path);
      setActionError(null);
      void logEvent("info", `ui: 用 IDE 打开文件 path=${path}`);
      if (outcome.message) setActionError(outcome.message);
    } catch (err) {
      setActionError(String(err));
    }
  };

  const refreshList = () => setRefreshKey((key) => key + 1);

  const handleArchiveOne = async (path: string) => {
    try {
      const outcome = await archiveFiles([path]);
      setArchiveNotice({ batchId: outcome.batchId ?? 0, count: outcome.archived });
      setArchiveError(null);
      refreshList();
      void logEvent("info", `ui: 归档文件 path=${path}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  };

  const handleArchiveSelected = async () => {
    if (selected.size === 0) return;
    const paths = items.filter((file) => selected.has(file.path)).map((file) => file.path);
    try {
      const outcome = await archiveFiles(paths);
      setArchiveNotice({ batchId: outcome.batchId ?? 0, count: outcome.archived });
      setArchiveError(outcome.failed[0]?.error ?? null);
      setSelected(new Set());
      setBatchMode(false);
      refreshList();
      void logEvent("info", `ui: 归档所选 count=${outcome.archived}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  };

  const handleArchiveFiltered = async () => {
    try {
      const outcome = await archiveFiltered(queryString);
      setArchiveNotice({ batchId: outcome.batchId ?? 0, count: outcome.archived });
      setArchiveError(outcome.failed[0]?.error ?? null);
      setSelected(new Set());
      setBatchMode(false);
      refreshList();
      void logEvent("info", `ui: 归档筛选 count=${outcome.archived}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  };

  const handleUndoArchive = async (batchId: number) => {
    try {
      const outcome = await undoArchive(batchId);
      setArchiveNotice(null);
      setArchiveError(outcome.failed[0]?.error ?? null);
      refreshList();
      void logEvent("info", `ui: 撤销归档 batch=${batchId}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  };

  const confirmArchive = () => {
    if (!archiveTarget) return;
    if (archiveTarget.mode === "selected") {
      void handleArchiveSelected();
    } else {
      void handleArchiveFiltered();
    }
    setArchiveTarget(null);
  };

  const filterActive =
    query.trim() !== "" || types.length > 0 || states.length > 0 || labels.length > 0;
  const unarchivedCount = items.filter((file) => file.state === "indexed").length;
  const archivePreview = (path: string, labels: string) => {
    const name = path.split("/").pop() ?? path;
    const first = labels.split(",")[0]?.trim() ?? "";
    const dir = first && first in CATEGORY_ICON ? first : "other";
    return `${archiveRoot}/${dir}/${name}`;
  };
  const archiveDescription = archiveTarget
    ? archiveTarget.mode === "selected"
      ? t("files.archiveConfirmSelectedDesc", {
          count: archiveTarget.count,
          root: archiveRoot,
          preview: items
            .filter((file) => selected.has(file.path))
            .slice(0, 3)
            .map((file) => archivePreview(file.path, file.labels))
            .join("\n"),
        })
      : t("files.archiveConfirmFilteredDesc", {
          count: archiveTarget.count,
          root: archiveRoot,
        })
    : "";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("pages.files.title")}
        description={t("pages.files.description")}
      />

      <SearchAutocomplete
        text={query}
        types={types}
        states={states}
        labels={labels}
        candidates={autocompleteCandidates}
        habits={habits}
        labelDefs={mergedLabelDefs}
        onHabitUsed={touch}
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
        labelDefs={mergedLabelDefs}
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

      {actionError && (
        <Banner variant="warn" className="mt-4">
          <span className="min-w-0 flex-1">{actionError}</span>
        </Banner>
      )}

      {autoArchive && archiveRoot && !autoHintHidden && (
        <Banner
          variant="info"
          className="mt-4"
          onClose={() => setAutoHintHidden(true)}
        >
          {t("files.autoArchiveOn")}
        </Banner>
      )}
      {archiveNotice && (
        <Banner
          variant="brand"
          className="mt-4"
          onClose={() => setArchiveNotice(null)}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleUndoArchive(archiveNotice.batchId)}
            >
              {t("files.undoArchive")}
            </Button>
          }
        >
          {t("files.archivedNotice", { count: archiveNotice.count })}
        </Banner>
      )}
      {archiveError && (
        <Banner
          variant="error"
          className="mt-4"
          onClose={() => setArchiveError(null)}
        >
          <span className="block truncate">{archiveError}</span>
        </Banner>
      )}

      {archiveRoot && (unarchivedCount > 0 || batchMode) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!batchMode && (
            <Button
              variant="secondary"
              size="sm"
              icon={CheckSquare}
              onClick={() => setBatchMode(true)}
            >
              {t("files.batchMode")}
            </Button>
          )}
          {filterActive && (
            <Button
              variant="danger"
              size="sm"
              icon={Archive}
              onClick={() =>
                setArchiveTarget({
                  mode: "filtered",
                  count: Math.min(total, 200),
                })
              }
            >
              {t("files.archiveFiltered", {
                count: total > 200 ? "200+" : total,
              })}
            </Button>
          )}
          {batchMode && (
            <>
              <span className="text-xs text-muted">
                {t("files.batchSelected", { count: selected.size })}
              </span>
              <Button
                variant="danger"
                size="sm"
                icon={Archive}
                disabled={selected.size === 0}
                onClick={() =>
                  setArchiveTarget({ mode: "selected", count: selected.size })
                }
              >
                {t("files.archiveSelected")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBatchMode(false);
                  setSelected(new Set());
                }}
              >
                {t("files.cancelSelection")}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="mt-4 min-h-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        {showLoadingBar && items.length > 0 && (
          <div className="h-px bg-brand-500/20" />
        )}
        {loading && items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t("files.loading")}
          </div>
        ) : watchedCount === 0 ? (
          <EmptyState
            title={t("files.empty")}
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => onNavigate("settings")}
              >
                {t("files.goSettings")}
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState title={t("files.noResults")} />
        ) : (
          <>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((file) => {
                const meta = fileStateMeta(file.state);
                const fileLabels = parseLabels(file.labels);
                return (
                  <li
                    key={file.path}
                    className="list-enter group flex items-center gap-3 px-4 py-2.5 text-sm"
                    title={file.path}
                  >
                    {batchMode && (
                      <input
                        type="checkbox"
                        aria-label={t("files.selectFile")}
                        checked={selected.has(file.path)}
                        onChange={(event) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (event.target.checked) {
                              next.add(file.path);
                            } else {
                              next.delete(file.path);
                            }
                            return next;
                          });
                        }}
                        className="size-4 shrink-0 accent-brand-600"
                      />
                    )}
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
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {mergedLabelDefs[label] && (
                              <span
                                className={`size-1.5 rounded-full ${LABEL_COLORS[labelColorKey(mergedLabelDefs[label].color)].dot}`}
                              />
                            )}
                            {mergedLabelDefs[label]
                              ? mergedLabelDefs[label].name
                              : t(`filter.${label}`, label)}
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
                    <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {file.state === "indexed" && archiveRoot && (
                        <IconButton
                          label={t("files.archive")}
                          icon={Archive}
                          tone="neutral"
                          size="sm"
                          onClick={() => void handleArchiveOne(file.path)}
                        />
                      )}
                      <IconButton
                        label={t("projects.open")}
                        icon={ExternalLink}
                        tone="neutral"
                        size="sm"
                        onClick={() => void handleOpenFile(file.path)}
                      />
                      <IconButton
                        label={t("projects.reveal")}
                        icon={LocateFixed}
                        tone="neutral"
                        size="sm"
                        onClick={() => void handleRevealFile(file.path)}
                      />
                      <IconButton
                        label={t("projects.openIde")}
                        icon={Code2}
                        tone="brand"
                        size="sm"
                        onClick={() => void handleIdeOpenFile(file.path)}
                      />
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
                  onClick={() => {
                    const next = offset + PAGE_SIZE;
                    setOffset(next);
                    void logEvent("info", `ui: 加载更多 offset=${next}`);
                  }}
                >
                  {t("files.loadMore")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={archiveTarget !== null}
        title={t("files.archiveConfirmTitle")}
        description={archiveDescription}
        confirmLabel={t("files.archiveConfirm", {
          count: archiveTarget?.count ?? 0,
        })}
        danger
        onConfirm={confirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
