import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CheckSquare,
  Code2,
  Copy,
  ExternalLink,
  LocateFixed,
} from "../theme/icons";
import { FileTypeIcon } from "../components/FileTypeIcon";import { FilterBar } from "../components/FilterBar";
import { SearchAutocomplete } from "../components/SearchAutocomplete";
import { useHelpCenter } from "../components/HelpCenter";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { PageHeader } from "../components/PageHeader";
import { PageHelpButton } from "../components/PageHelpButton";
import { VirtualRows } from "../components/VirtualRows";
import { useSettings } from "../hooks/useSettings";
import type { PageKey } from "../lib/nav";
import { useFiles } from "../hooks/useFiles";
import { useFilterHabits } from "../hooks/useFilterHabits";
import { useLabelDefs } from "../hooks/useLabelDefs";
import type { ScanController } from "../hooks/useScan";
import { LABEL_COLORS, labelColorKey } from "../lib/labelDefs";
import { resolveCategoryKey } from "../lib/categoryDefs";
import { buildCourseLabelDefs } from "../lib/studyStore";
import { getStudyData } from "../lib/tauri";
import {
  fileStateMeta,
  buildQuery,
  FILTER_STATE_OPTIONS,
  formatFileSize,
  formatFileSizeParts,
  parseLabels,
  sortLabelsByPriority,
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
  type SortDir,
  type SortField,
} from "../lib/tauri";

const PAGE_SIZE = 50;

const CODE_EDITOR_EXTENSIONS = new Set([
  "rs",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "go",
  "java",
  "kt",
  "kts",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "cc",
  "php",
  "rb",
  "swift",
  "dart",
  "sh",
  "bat",
  "cmd",
  "ps1",
  "toml",
  "yml",
  "yaml",
  "json",
  "xml",
  "sql",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
  "md",
  "txt",
  "tex",
  "zig",
  "lua",
  "r",
]);

const KEYWORD_DISPLAY_KEY: Record<string, string> = {
  "type:": "files.acKeywordType",
  "label:": "files.acKeywordLabel",
  "+label:": "files.acKeywordLabelAll",
  "state:": "files.acKeywordState",
  "size:": "files.acKeywordSize",
  "before:": "files.acKeywordBefore",
  "after:": "files.acKeywordAfter",
};

/** 虚拟列表固定行高（与现有行 py-3 单行形态一致） */
const FILE_ROW_HEIGHT = 56;
/** 超过该数量启用虚拟滚动，小列表保持原渲染（布局不变） */
const VIRTUAL_ROW_THRESHOLD = 200;

export function FilePage({
  onNavigate,
  scan,
}: {
  onNavigate: (page: PageKey) => void;
  scan: ScanController;
}) {
  const { t } = useTranslation();
  const { openHelp } = useHelpCenter();
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
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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

  const dedupedAvailableLabels = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of availableLabels) {
      const name = mergedLabelDefs[key]?.name ?? key;
      const norm = name.trim().toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(key);
      }
    }
    return out;
  }, [availableLabels, mergedLabelDefs]);

  const orderedAvailableLabels = useMemo(
    () =>
      sortLabelsByPriority(
        dedupedAvailableLabels,
        (key) => key in courseLabelDefs,
      ),
    [dedupedAvailableLabels, courseLabelDefs],
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
      ...orderedAvailableLabels.map((label) => ({
        kind: "label" as const,
        key: `label:${label}`,
        raw: label,
        token: `label:${label}`,
        display: mergedLabelDefs[label]?.name ?? label,
      })),
    ];
  }, [categories, orderedAvailableLabels, mergedLabelDefs, t]);

  const { items, total, loading, stale, hasMore } = useFiles(
    queryString,
    PAGE_SIZE,
    offset,
    refreshKey,
    sortField,
    sortDir,
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

  const toggleSort = (field: SortField) => {
    setOffset(0);
    if (sortField === field) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    void logEvent("info", `ui: 排序 field=${field}`);
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

  const handleCopyPath = async (path: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = path;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setActionError(null);
      void logEvent("info", `ui: 复制路径 path=${path}`);
    } catch {
      setActionError(t("files.copyPathFailed"));
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
    const dir = resolveCategoryKey(first);
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
        actions={<PageHelpButton target="tasks.files" />}
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
        labels={orderedAvailableLabels}
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

      <div
        className={`mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900 ${
          loading || items.length === 0 ? "min-h-64" : ""
        }`}
      >
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
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => onNavigate("settings")}
                >
                  {t("files.goSettings")}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => openHelp("tasks.gettingStarted")}
                >
                  {t("files.helpGettingStarted")}
                </Button>
              </div>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t("files.noResults")}
            action={
              <Button
                variant="ghost"
                size="md"
                onClick={() => openHelp("tasks.searchTips")}
              >
                {t("files.helpSearchTips")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
              {(["name", "type", "size", "modified", "labels"] as SortField[]).map(
                (field) => {
                  const active = sortField === field;
                  return (
                    <button
                      key={field}
                      type="button"
                      onClick={() => toggleSort(field)}
                      className={`rounded px-2 py-1 text-xs transition-colors ${
                        active
                          ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                      }`}
                    >
                      {t(`files.sort${field[0].toUpperCase()}${field.slice(1)}`)}
                      {active && (
                        <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  );
                },
              )}
            </div>
            {(() => {
              const rowContent = (file: (typeof items)[number]) => {
                const meta = fileStateMeta(file.state);
                const fileLabels = parseLabels(file.labels);
                const dedupedLabels = (() => {
                  const seen = new Set<string>();
                  const out: string[] = [];
                  for (const key of fileLabels) {
                    const name = mergedLabelDefs[key]
                      ? mergedLabelDefs[key].name
                      : t(`filter.${key}`, key);
                    const norm = name.trim().toLowerCase();
                    if (!seen.has(norm)) {
                      seen.add(norm);
                      out.push(key);
                    }
                  }
                  return out;
                })();
                const sortedLabels = sortLabelsByPriority(
                  dedupedLabels,
                  (key) => key in courseLabelDefs,
                );
                const firstLabel = sortedLabels[0];
                const firstDef = firstLabel
                  ? mergedLabelDefs[firstLabel]
                  : undefined;
                const firstName = firstLabel
                  ? firstDef
                    ? firstDef.name
                    : t(`filter.${firstLabel}`, firstLabel)
                  : "";
                const sizeParts = formatFileSizeParts(file.size);
                const canIdeOpen = CODE_EDITOR_EXTENSIONS.has(
                  file.file_type.toLowerCase(),
                );
                return (
                  <li
                    key={file.path}
                    className="list-enter group flex items-center gap-1.5 px-4 py-3 text-sm"
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
                    <span className="w-56 shrink-0">
                      <span
                        className="block truncate font-medium text-slate-800 dark:text-slate-100"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      {sortedLabels.length > 0 && (
                        <span className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
                          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            {firstDef && (
                              <span
                                className={`size-1.5 rounded-full ${LABEL_COLORS[labelColorKey(firstDef.color)].dot}`}
                              />
                            )}
                            <span className="truncate" title={firstName}>
                              {firstName}
                            </span>
                          </span>
                          {sortedLabels.length > 1 && (
                            <span
                              className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                              title={sortedLabels
                                .slice(1)
                                .map((label) =>
                                  mergedLabelDefs[label]
                                    ? mergedLabelDefs[label].name
                                    : t(`filter.${label}`, label),
                                )
                                .join(", ")}
                            >
                              +{sortedLabels.length - 1}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span
                      className="ml-2 w-14 min-w-0 shrink-0 truncate text-left font-mono text-xs text-slate-400 dark:text-slate-500"
                      title={file.file_type || "—"}
                    >
                      {file.file_type || "—"}
                    </span>
                    <span
                      className="w-14 min-w-0 shrink-0 truncate text-left font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500"
                      title={formatFileSize(file.size)}
                    >
                      {sizeParts.value}
                      {sizeParts.unit && (
                        <span className="ml-0.5 text-slate-500 dark:text-slate-400">
                          {sizeParts.unit}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {file.state === "indexed" && archiveRoot && (
                        <IconButton
                          label={t("files.archive")}
                          icon={Archive}
                          tone="neutral"
                          size="md"
                          onClick={() => void handleArchiveOne(file.path)}
                        />
                      )}
                      <IconButton
                        label={t("files.copyPath")}
                        icon={Copy}
                        tone="neutral"
                        size="md"
                        onClick={() => void handleCopyPath(file.path)}
                      />
                      <IconButton
                        label={t("files.openSmart")}
                        icon={ExternalLink}
                        tone="neutral"
                        size="md"
                        onClick={() => void handleOpenFile(file.path)}
                      />
                      <IconButton
                        label={t("projects.reveal")}
                        icon={LocateFixed}
                        tone="neutral"
                        size="md"
                        onClick={() => void handleRevealFile(file.path)}
                      />
                      {canIdeOpen && (
                        <IconButton
                          label={t("projects.openIde")}
                          icon={Code2}
                          tone="brand"
                          size="md"
                          onClick={() => void handleIdeOpenFile(file.path)}
                        />
                      )}
                    </span>
                    <span className="flex w-14 min-w-0 shrink-0 items-center gap-1.5 text-left text-xs text-slate-500 dark:text-slate-400">
                      <span className={`size-1.5 shrink-0 rounded-full ${meta.dotClass}`} />
                      <span className="truncate" title={t(meta.labelKey)}>
                        {t(meta.labelKey)}
                      </span>
                    </span>
                  </li>
                );
              };
              return items.length > VIRTUAL_ROW_THRESHOLD ? (
                <VirtualRows
                  total={items.length}
                  rowHeight={FILE_ROW_HEIGHT}
                  renderRow={(index) => rowContent(items[index])}
                />
              ) : (
                <ul className="@container divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map(rowContent)}
                </ul>
              );
            })()}
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <div className="flex items-center gap-3">
                <span>
                  {t("files.pageInfo", {
                    page: Math.floor(offset / PAGE_SIZE) + 1,
                  })}
                </span>
                <span>
                  {total >= 0
                    ? t("files.countInfo", {
                        shown: items.length,
                        total,
                      })
                    : t("files.countShown", { shown: items.length })}
                </span>
              </div>
              {hasMore && (
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
