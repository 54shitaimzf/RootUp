import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  Code2,
  FolderOpen,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import type { PageKey } from "../lib/nav";
import {
  addProjectDir,
  createProjectShortcut,
  listProjects,
  logEvent,
  openProject,
  removeProjectDir,
  revealInExplorer,
  type ProjectInfo,
} from "../lib/tauri";
import { PROJECT_KIND_LABEL_KEY, ProjectKindBadge } from "../components/ProjectKindBadge";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { IconButton } from "../components/IconButton";

export function ProjectsPage({
  onNavigate,
}: {
  onNavigate: (page: PageKey) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDir, setNewDir] = useState("");

  const manualDirs = new Set(settings?.project_dirs ?? []);

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

  const handleAdd = async () => {
    const dir = newDir.trim();
    if (!dir) return;
    try {
      await addProjectDir(dir);
      setNewDir("");
      setError(null);
      setNotice(t("projects.added"));
      await load();
      void logEvent("info", `ui: 添加项目 dir=${dir}`);
    } catch (err) {
      setError(String(err));
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

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-strong">
        {t("pages.projects.title")}
      </h1>
      <p className="mt-1 text-sm text-muted">{t("pages.projects.description")}</p>

      {notice && (
        <Banner variant="brand" className="mt-4">
          {notice}
        </Banner>
      )}
      {error && (
        <Banner variant="error" className="mt-4">
          <span className="block truncate">{error}</span>
        </Banner>
      )}

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={newDir}
          onChange={(event) => setNewDir(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleAdd();
          }}
          placeholder={t("projects.addPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
        />
        <Button variant="primary" size="md" icon={Plus} onClick={() => void handleAdd()}>
          {t("projects.add")}
        </Button>
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
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-muted shadow-card dark:border-slate-800 dark:bg-slate-900">
            <p>{t("projects.empty")}</p>
            <Button
              variant="primary"
              size="md"
              className="mt-3"
              onClick={() => onNavigate("settings")}
            >
              {t("projects.goSettings")}
            </Button>
          </div>
        ) : (
          projects.map((project) => {
            const isManual = manualDirs.has(project.path);
            return (
              <div
                key={project.path}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
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
                      {isManual && (
                        <span className="rounded bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                          {t("projects.manual")}
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
    </div>
  );
}
