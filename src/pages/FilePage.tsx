import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { FilterBar } from "../components/FilterBar";
import { PageHeader } from "../components/PageHeader";
import { PageHelpButton } from "../components/PageHelpButton";
import { SearchAutocomplete } from "../components/SearchAutocomplete";
import { SegmentedControl } from "../components/SegmentedControl";
import { useHelpCenter } from "../components/HelpCenter";
import { useSettings } from "../hooks/useSettings";
import { useFiles } from "../hooks/useFiles";
import { useFilterHabits } from "../hooks/useFilterHabits";
import { useLabelDefs } from "../hooks/useLabelDefs";
import type { ScanController } from "../hooks/useScan";
import { buildQuery, sortLabelsByPriority } from "../lib/fileUtils";
import type { TagValue } from "../lib/autocomplete";
import type { PageKey } from "../lib/nav";
import { buildCourseLabelDefs } from "../lib/studyStore";
import {
  getStudyData,
  listCategories,
  listLabels,
  watchedDirsOverview,
  logEvent,
  openFile,
  openProjectFromFile,
  revealInExplorer,
  deleteToTrash,
  extractArchive,
  type FileRecord,
  type SortDir,
  type SortField,
} from "../lib/tauri";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FileBanners } from "../features/files/components/FileBanners";
import { ArchiveConfirmDialog } from "../features/files/components/ArchiveConfirmDialog";
import { FileList } from "../features/files/components/FileList";
import { FileToolbar } from "../features/files/components/FileToolbar";
import { useFileArchive } from "../features/files/hooks/useFileArchive";
import {
  PAGE_SIZE,
  buildAutocompleteCandidates,
  presentRow,
} from "../features/files/model";

/** 归档批量上限（与后端 archive_filtered 上限一致）。 */
const ARCHIVE_BATCH_LIMIT = 200;

/**
 * 文件页（页面壳）：只做状态装配、行为处理与布局组合。
 * 行渲染、列表、批量工具条、横幅与归档弹层在 features/files/components/，
 * 纯逻辑在 features/files/model.ts，归档动作状态机在 hooks/useFileArchive；
 * 本文件不承载大段 UI 实现。这是阶段二四视图切换的共同前置。
 */
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
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
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
  /** 操作错误（打开/删除/解压失败等）：error 级横幅，可关闭。 */
  const [actionError, setActionError] = useState<string | null>(null);
  /** 操作通知（复制成功、IDE 已打开等）：brand 级横幅，可关闭。 */
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [autoHintHidden, setAutoHintHidden] = useState(false);
  /** 回收站删除确认（0.8.8）：行级入口，paths 预留批量。 */
  const [deleteTarget, setDeleteTarget] = useState<{ paths: string[] } | null>(
    null,
  );
  /** 四视图（0.8.7 阶段二）：默认「文件」保持既有行为零回归；kind 注入 kind: token。 */
  const [view, setView] = useState<"all" | "file" | "project" | "software">(
    "file",
  );

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
    watchedDirsOverview()
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
    () =>
      buildQuery({
        text: debouncedQuery,
        kind: view === "all" ? undefined : view,
        categories: selectedCategories,
        states,
        labels,
      }),
    [debouncedQuery, view, selectedCategories, states, labels],
  );

  const autocompleteCandidates = useMemo(
    () =>
      buildAutocompleteCandidates({
        categories,
        orderedAvailableLabels,
        mergedLabelDefs,
        t,
      }),
    [categories, orderedAvailableLabels, mergedLabelDefs, t],
  );

  const { items, total, loading, stale, hasMore } = useFiles(
    queryString,
    PAGE_SIZE,
    offset,
    refreshKey,
    sortField,
    sortDir,
  );

  // FileRow 已 memo：所有传给行渲染的 handler 保持引用稳定，否则按键级重渲全部行。
  const refreshList = useCallback(() => setRefreshKey((key) => key + 1), []);

  const archive = useFileArchive(items, queryString, refreshList);

  // 刷新指示延迟出现：150ms 内完成的查询不显示，避免正常操作时可见
  useEffect(() => {
    if (!loading) {
      setShowLoadingBar(false);
      return;
    }
    const timer = window.setTimeout(() => setShowLoadingBar(true), 150);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const presentations = useMemo(
    () =>
      items.map((file) => presentRow(file, mergedLabelDefs, courseLabelDefs, t)),
    [items, mergedLabelDefs, courseLabelDefs, t],
  );

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

  const handleOpenFile = useCallback(async (path: string) => {
    try {
      await openFile(path);
      setActionError(null);
      setActionNotice(null);
      void logEvent("info", `ui: 打开文件 path=${path}`);
    } catch (err) {
      setActionError(String(err));
    }
  }, []);

  const handleRevealFile = useCallback(async (path: string) => {
    try {
      await revealInExplorer(path);
      setActionError(null);
      setActionNotice(null);
      void logEvent("info", `ui: 定位文件 path=${path}`);
    } catch (err) {
      setActionError(String(err));
    }
  }, []);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const paths = deleteTarget.paths;
    setDeleteTarget(null);
    try {
      const outcome = await deleteToTrash(paths, false);
      if (outcome.deleted > 0) {
        setRefreshKey((key) => key + 1);
        void logEvent("info", `ui: 回收站删除 count=${outcome.deleted}`);
      }
      if (outcome.failed.length > 0) {
        const first = outcome.failed[0];
        setActionError(`${first.path}: ${first.error}`);
      } else {
        setActionError(null);
        setActionNotice(null);
      }
    } catch (err) {
      setActionError(String(err));
    }
  };

  const handleExtract = useCallback(async (path: string) => {
    try {
      const outcome = await extractArchive(path);
      setRefreshKey((key) => key + 1);
      setActionError(null);
      setActionNotice(null);
      void logEvent(
        "info",
        `ui: 解压 path=${path} dest=${outcome.dest} files=${outcome.files}`,
      );
    } catch (err) {
      setActionError(String(err));
    }
  }, []);

  const handleCopyPath = useCallback(
    async (path: string) => {
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
        setActionNotice(t("files.copyPathDone"));
        void logEvent("info", `ui: 复制路径 path=${path}`);
      } catch {
        setActionNotice(null);
        setActionError(t("files.copyPathFailed"));
      }
    },
    [t],
  );

  const handleIdeOpenFile = useCallback(async (path: string) => {
    try {
      const outcome = await openProjectFromFile(path);
      setActionError(null);
      void logEvent("info", `ui: 用 IDE 打开文件 path=${path}`);
      if (outcome.message) setActionNotice(outcome.message);
    } catch (err) {
      setActionError(String(err));
    }
  }, []);

  const filterActive =
    query.trim() !== "" ||
    selectedCategories.length > 0 ||
    states.length > 0 ||
    labels.length > 0;
  const unarchivedCount = useMemo(
    () => items.filter((file) => file.state === "indexed").length,
    [items],
  );

  const archiveVisible = useCallback(
    (file: FileRecord) => file.state === "indexed" && archiveRoot !== "",
    [archiveRoot],
  );

  const rowHandlers = useMemo(
    () => ({
      onArchive: (path: string) => void archive.handleArchiveOne(path),
      onCopyPath: (path: string) => void handleCopyPath(path),
      onOpen: (path: string) => void handleOpenFile(path),
      onReveal: (path: string) => void handleRevealFile(path),
      onIdeOpen: (path: string) => void handleIdeOpenFile(path),
      onDelete: (path: string) => setDeleteTarget({ paths: [path] }),
      onExtract: (path: string) => void handleExtract(path),
    }),
    [
      archive.handleArchiveOne,
      handleCopyPath,
      handleOpenFile,
      handleRevealFile,
      handleIdeOpenFile,
      handleExtract,
    ],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("pages.files.title")}
        description={t("pages.files.description")}
        actions={<PageHelpButton target="tasks.files" />}
      />

      {/* 四视图切换：全部 / 文件 / 项目 / 软件（kind: 语法，见 model.ts 视图 token） */}
      <SegmentedControl
        value={view}
        onChange={(value) => {
          setView(value);
          setOffset(0);
          void logEvent("info", `ui: 文件页视图 ${value}`);
        }}
        variant="pill"
        ariaLabel={t("files.viewSwitchLabel")}
        className="mb-2"
        options={(["all", "file", "project", "software"] as const).map(
          (value) => ({
            value,
            label: t(
              value === "all"
                ? "filter.all"
                : value === "file"
                  ? "filter.file"
                  : value === "project"
                    ? "filter.project"
                    : "filter.software",
            ),
          }),
        )}
      />

      <SearchAutocomplete
        text={query}
        categories={selectedCategories}
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
          setSelectedCategories(tags.categories);
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
        selectedCategories={selectedCategories}
        selectedLabels={labels}
        onCategoriesChange={(value) => {
          setSelectedCategories(value);
          setOffset(0);
        }}
        onLabelsChange={(value) => {
          setLabels(value);
          setOffset(0);
        }}
      />

      <FileBanners
        scan={scan}
        stale={stale}
        onRefresh={handleRefresh}
        actionError={actionError}
        onDismissActionError={() => setActionError(null)}
        actionNotice={actionNotice}
        onDismissActionNotice={() => setActionNotice(null)}
        autoArchiveHintVisible={Boolean(autoArchive && archiveRoot && !autoHintHidden)}
        onDismissAutoHint={() => setAutoHintHidden(true)}
        archiveNotice={archive.archiveNotice}
        onUndoArchive={(batchId) => void archive.handleUndoArchive(batchId)}
        onDismissNotice={archive.dismissNotice}
        archiveError={archive.archiveError}
        onDismissError={archive.dismissError}
        archiveFailure={archive.archiveFailure}
        onDismissFailure={archive.dismissFailure}
      />

      <FileToolbar
        archiveRootConfigured={archiveRoot !== ""}
        unarchivedCount={unarchivedCount}
        batchMode={archive.batchMode}
        filterActive={filterActive}
        selectedCount={archive.selected.size}
        filteredCount={total ?? -1}
        archiveBatchLimit={ARCHIVE_BATCH_LIMIT}
        onEnterBatchMode={archive.enterBatchMode}
        onArchiveSelected={archive.openArchiveSelected}
        onArchiveFiltered={() => archive.openArchiveFiltered(total ?? -1, ARCHIVE_BATCH_LIMIT)}
        onCancelSelection={archive.cancelSelection}
      />

      <div
        className={`mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900 ${
          loading || items.length === 0 ? "min-h-64" : ""
        }`}
      >
        {showLoadingBar && items.length > 0 && (
          <div className="h-px bg-brand-500/20" />
        )}
        {loading && items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">
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
        ) : view === "software" && items.length === 0 ? (
          <EmptyState
            title={t("files.softwareComingTitle")}
            description={t("files.softwareComingDesc")}
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
          <FileList
            items={items}
            presentations={presentations}
            labelDefs={mergedLabelDefs}
            sortField={sortField}
            sortDir={sortDir}
            onSortToggle={toggleSort}
            batchMode={archive.batchMode}
            selected={archive.selected}
            onToggleSelect={archive.toggleSelect}
            archiveVisible={archiveVisible}
            rowHandlers={rowHandlers}
            offset={offset}
            pageSize={PAGE_SIZE}
            total={total}
            hasMore={hasMore}
            onLoadMore={() => {
              const next = offset + PAGE_SIZE;
              setOffset(next);
              void logEvent("info", `ui: 加载更多 offset=${next}`);
            }}
          />
        )}
      </div>
      <ArchiveConfirmDialog
        target={archive.archiveTarget}
        archiveRoot={archiveRoot}
        items={items}
        selected={archive.selected}
        preflight={archive.preflight}
        riskConfirmed={archive.riskConfirmed}
        onRiskConfirmChange={archive.setRiskConfirmed}
        onConfirm={archive.confirmArchive}
        onCancel={archive.closeArchiveTarget}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("files.deleteConfirmTitle")}
        description={t("files.deleteConfirmDesc", {
          count: deleteTarget?.paths.length ?? 0,
        })}
        confirmLabel={t("files.deleteConfirm")}
        danger
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
