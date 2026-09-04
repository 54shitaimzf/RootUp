import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog";
import { PagePlaceholder } from "./components/PagePlaceholder";
import { Sidebar } from "./components/Sidebar";
import type { PageKey } from "./lib/nav";
import { useScan, type ScanController } from "./hooks/useScan";
import { useImeGuard } from "./hooks/useImeGuard";
import { SettingsProvider, useSettings } from "./hooks/useSettings";
import i18n from "./i18n";
import { APP_EVENTS } from "./lib/events";
import { ThemeProvider } from "./theme/ThemeProvider";
import { HelpCenterProvider } from "./components/HelpCenter";
import { appReady, takeStartupIntent } from "./lib/tauri";
import { FilePage } from "./pages/FilePage";

// 0.8.6 阶段二：页面级懒加载（首包只含文件页入口链与共享组件）
const ProjectsPage = lazy(() =>
  import("./pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })),
);
const StudyPage = lazy(() =>
  import("./pages/StudyPage").then((m) => ({ default: m.StudyPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

function PageLoadingFallback() {
  return (
    <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">
      {i18n.t("files.loading")}
    </div>
  );
}

function renderPage(
  page: PageKey,
  {
    onNavigate,
    scan,
    studyFocus,
    setStudyFocus,
    reminderEnabled,
    leadDays,
  }: {
    onNavigate: (page: PageKey) => void;
    scan: ScanController;
    studyFocus: { homeworkId?: string } | null;
    setStudyFocus: (value: { homeworkId?: string } | null) => void;
    reminderEnabled: boolean;
    leadDays: number;
  },
) {
  switch (page) {
    case "settings":
      return <SettingsPage scan={scan} />;
    case "files":
      return <FilePage onNavigate={onNavigate} scan={scan} />;
    case "projects":
      return <ProjectsPage onNavigate={onNavigate} />;
    case "study":
      return (
        <StudyPage
          reminderEnabled={reminderEnabled}
          leadDays={leadDays}
          focusHomework={studyFocus}
          onFocusConsumed={() => setStudyFocus(null)}
        />
      );
    case "tools":
      return (
        <PagePlaceholder
          titleKey="pages.tools.title"
          descriptionKey="pages.tools.description"
        />
      );
  }
}

export default function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

function Shell() {
  useImeGuard();
  const [page, setPage] = useState<PageKey>("files");
  const [studyFocus, setStudyFocus] = useState<{
    homeworkId?: string;
  } | null>(null);
  const { settings, update } = useSettings();
  const scan = useScan();

  useEffect(() => {
    let unlistenHomework: (() => void) | undefined;
    let unlistenProject: (() => void) | undefined;
    listen<string | null>(APP_EVENTS.studyHomeworkOpen, (event) => {
      setPage("study");
      setStudyFocus(event.payload ? { homeworkId: event.payload } : {});
    })
      .then((fn) => {
        unlistenHomework = fn;
      })
      .catch(() => {});
    listen<string>(APP_EVENTS.projectOpen, () => {
      setPage("projects");
    })
      .then((fn) => {
        unlistenProject = fn;
      })
      .catch(() => {});
    return () => {
      unlistenHomework?.();
      unlistenProject?.();
    };
  }, []);

  // 首次启动深链：事件可能在监听器就绪前发出，改为启动后领取一次
  useEffect(() => {
    let cancelled = false;
    takeStartupIntent()
      .then((intent) => {
        if (cancelled || !intent) return;
        if (intent.kind === "project") {
          setPage("projects");
        } else {
          setPage("study");
          setStudyFocus({});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 前端就绪后启动后端延迟服务
  useEffect(() => {
    void appReady().catch(() => {});
  }, []);

  // 语言随设置变化即时切换
  useEffect(() => {
    if (settings) {
      void i18n.changeLanguage(settings.language);
    }
  }, [settings?.language]);

  return (
    <ThemeProvider>
      <HelpCenterProvider onNavigate={setPage}>
        <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
          <Sidebar current={page} onNavigate={setPage} />
          <main className="flex-1 overflow-auto p-8 [scrollbar-gutter:stable]">
            <Suspense fallback={<PageLoadingFallback />}>
              {renderPage(page, {
                onNavigate: setPage,
                scan,
                studyFocus,
                setStudyFocus,
                reminderEnabled: settings?.reminder_enabled ?? false,
                leadDays: settings?.reminder_lead_days ?? 3,
              })}
            </Suspense>
          </main>
        </div>
        <CloseConfirmDialog
          onRemember={(action) => update({ close_action: action })}
        />
      </HelpCenterProvider>
    </ThemeProvider>
  );
}
