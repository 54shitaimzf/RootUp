import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  Code2,
  FolderOpen,
  Link2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import type { PageKey } from "../lib/nav";
import {
  addProjectDir,
  archiveProject,
  createProjectShortcut,
  listDetectedTools,
  listCommonDirs,
  listProjects,
  logEvent,
  openProject,
  removeProjectDir,
  revealInExplorer,
  undoArchive,
  type CommonDirEntry,
  type OpenOutcome,
  type ProjectInfo,
} from "../lib/tauri";
import { PROJECT_KIND_LABEL_KEY, ProjectKindBadge } from "../components/ProjectKindBadge";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { PageHeader } from "../components/PageHeader";
import { useHelpCenter } from "../components/HelpCenter";
import { DirectoryAdder } from "../components/DirectoryAdder";

export function ProjectsPage({
  onNavigate,
}: {
  onNavigate: (page: PageKey) => void;
}) {
  const { t } = useTranslation();
  const { openHelp } = useHelpCenter();
  const { settings } = useSettings();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState<OpenOutcome | null>(null);
  const [detectedTools, setDetectedTools] = useState<string[] | null>(null);
  const [commonDirs, setCommonDirs] = useState<CommonDirEntry[]>([]);
  const [hideIdeHint, setHideIdeHint] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProjectInfo | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<{
    batchId: number;
    count: number;
  } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await listProjects());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listDetectedTools()
      .then(setDetectedTools)
      .catch(() => setDetectedTools([]));
    listCommonDirs()
      .then(setCommonDirs)
      .catch(() => setCommonDirs([]));
  }, []);

  // 快捷方式唤起 RootUp 时自动切到本页并刷新
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("project-open", () => {
      void load();
      setNotice(t("projects.openedFromShortcut"));
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [load, t]);

  const handleAddProject = async (dir: string): Promise<string | null> => {
    try {
      await addProjectDir(dir);
      setNotice(t("projects.added"));
      await load();
      void logEvent("info", `ui: 添加项目 dir=${dir}`);
      return null;
    } catch (err) {
      return String(err);
    }
  };

  const handleRemove = async (project: ProjectInfo) => {
    try {
      await removeProjectDir(project.path);
      await load();
      void logEvent("info", `ui: 移除项目 path=${project.path}`);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpen = async (project: ProjectInfo) => {
    try {
      const outcome = await openProject(project.path);
      setLastOpen(outcome);
      setNotice(outcome.message ?? t("projects.opened"));
      void logEvent("info", `ui: 打开项目 path=${project.path}`);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleReveal = async (project: ProjectInfo) => {
    try {
      await revealInExplorer(project.path);
      void logEvent("info", `ui: 定位项目 path=${project.path}`);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleShortcut = async (project: ProjectInfo) => {
    try {
      const outcome = await createProjectShortcut(project.path);
      setNotice(t("projects.shortcutCreated", { name: outcome.name }));
      void logEvent("info", `ui: 创建快捷方式 path=${project.path}`);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleArchive = async (project: ProjectInfo) => {
    try {
      const outcome = await archiveProject(project.path);
      setArchiveNotice({ batchId: outcome.batchId ?? 0, count: outcome.archived });
      setArchiveError(null);
      await load();
      void logEvent("info", `ui: 归档项目 path=${project.path}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  };

  const handleUndoArchive = async (batchId: number) => {
    try {
      const outcome = await undoArchive(batchId);
      setArchiveNotice(null);
      setArchiveError(outcome.failed[0]?.error ?? null);
      await load();
      void logEvent("info", `ui: 撤销归档项目 batch=${batchId}`);
    } catch (err) {
      setArchiveError(String(err));
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("pages.projects.title")}
        description={t("pages.projects.description")}
      />

      {notice && (
        <Banner
          variant="brand"
          className="mt-4"
          actions={
            lastOpen?.openedWith === "explorer" && !lastOpen.tool ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openHelp("guide")}
              >
                {t("projects.ideLearnMore")}
              </Button>
            ) : undefined
          }
        >
          {notice}
        </Banner>
      )}
      {error && (
        <Banner variant="error" className="mt-4">
          <span className="block truncate">{error}</span>
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
          {t("projects.archivedNotice", { count: archiveNotice.count })}
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

      {!hideIdeHint &&
        detectedTools &&
        detectedTools.length === 0 &&
        projects.some((project) => project.kind !== "generic") && (
          <Banner
            variant="warn"
            className="mt-4"
            actions={
              <>
                <Button
                  variant="amber"
                  size="sm"
                  onClick={() => openHelp("guide")}
                >
                  {t("projects.ideHintAction")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHideIdeHint(true)}
                >
                  {t("projects.dismiss")}
                </Button>
              </>
            }
          >
            <span className="min-w-0 flex-1">{t("projects.ideHintTitle")}</span>
          </Banner>
        )}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <DirectoryAdder
            placeholder={t("projects.addPlaceholder")}
            hint={t("projects.addHint")}
            addLabel={t("projects.add")}
            browseLabel={t("settings.browse")}
            commonDirs={commonDirs}
            onAdd={handleAddProject}
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          icon={RefreshCw}
          onClick={() => void load()}
        >
          {t("projects.rescan")}
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {loading && projects.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted">
            {t("files.loading")}
          </p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
            <EmptyState
              title={t("projects.empty")}
              action={
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => onNavigate("settings")}
                >
                  {t("projects.goSettings")}
                </Button>
              }
            />
          </div>
        ) : (
          projects.map((project) => {
            const isManual = project.source === "manual";
            return (
              <div
                key={project.path}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start gap-3">
                  <ProjectKindBadge kind={project.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-secondary">
                        {project.name}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t(PROJECT_KIND_LABEL_KEY[project.kind])}
                      </span>
                      {isManual ? (
                        <span className="rounded bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                          {t("projects.sourceManual")}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {t("projects.sourceAuto")}
                        </span>
                      )}
                      {project.detectedBy && (
                        <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {t("projects.detectedBy", {
                            feature: project.detectedBy,
                          })}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-muted">
                      {project.path}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={t("projects.open")}
                      icon={Code2}
                      tone="brand"
                      onClick={() => void handleOpen(project)}
                    />
                    <IconButton
                      label={t("projects.reveal")}
                      icon={FolderOpen}
                      tone="neutral"
                      onClick={() => void handleReveal(project)}
                    />
                    <IconButton
                      label={t("projects.createShortcut")}
                      icon={Link2}
                      tone="neutral"
                      onClick={() => void handleShortcut(project)}
                    />
                    {settings?.archive_root?.trim() && (
                      <IconButton
                        label={t("projects.archive")}
                        icon={Archive}
                        tone="neutral"
                        onClick={() => setArchiveTarget(project)}
                      />
                    )}
                    {isManual && (
                      <ConfirmButton
                        label={<Trash2 className="size-3.5" />}
                        pendingLabel={t("projects.confirmRemove")}
                        onConfirm={() => void handleRemove(project)}
                        ariaLabel={t("projects.remove")}
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-500/15"
                        pendingClassName="rounded bg-red-50 px-2 text-[10px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <ConfirmDialog
        open={archiveTarget !== null}
        title={t("projects.archiveConfirmTitle")}
        description={
          archiveTarget
            ? t("projects.archiveConfirmDesc", {
                name: archiveTarget.name,
                dest: `${settings?.archive_root?.trim() ?? ""}/项目/${archiveTarget.name}`,
              })
            : ""
        }
        confirmLabel={t("projects.archiveConfirm")}
        danger
        onConfirm={() => {
          if (archiveTarget) void handleArchive(archiveTarget);
          setArchiveTarget(null);
        }}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
