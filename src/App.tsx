import { useEffect, useState } from "react";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog";
import { PagePlaceholder } from "./components/PagePlaceholder";
import { Sidebar } from "./components/Sidebar";
import type { PageKey } from "./lib/nav";
import { useScan, type ScanController } from "./hooks/useScan";
import { SettingsProvider, useSettings } from "./hooks/useSettings";
import i18n from "./i18n";
import { SettingsPage } from "./pages/SettingsPage";
import { FilePage } from "./pages/FilePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { StudyPage } from "./pages/StudyPage";
import { ThemeProvider } from "./theme/ThemeProvider";
import { HelpCenterProvider } from "./components/HelpCenter";

function renderPage(
  page: PageKey,
  {
    onNavigate,
    scan,
  }: {
    onNavigate: (page: PageKey) => void;
    scan: ScanController;
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
      return <StudyPage />;
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
      <HelpCenterProvider>
        <Shell />
      </HelpCenterProvider>
    </SettingsProvider>
  );
}

function Shell() {
  const [page, setPage] = useState<PageKey>("files");
  const { settings } = useSettings();
  const scan = useScan();

  // 语言随设置变化即时切换
  useEffect(() => {
    if (settings) {
      void i18n.changeLanguage(settings.language);
    }
  }, [settings?.language]);

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
        <Sidebar current={page} onNavigate={setPage} />
        <main className="flex-1 overflow-auto p-8">
          {renderPage(page, { onNavigate: setPage, scan })}
        </main>
      </div>
      <CloseConfirmDialog />
    </ThemeProvider>
  );
}
