import { useEffect, useState } from "react";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog";
import { PagePlaceholder } from "./components/PagePlaceholder";
import { Sidebar, type PageKey } from "./components/Sidebar";
import { SettingsProvider, useSettings } from "./hooks/useSettings";
import i18n from "./i18n";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemeProvider } from "./theme/ThemeProvider";

function renderPage(page: PageKey) {
  switch (page) {
    case "settings":
      return <SettingsPage />;
    case "files":
      return (
        <PagePlaceholder
          titleKey="pages.files.title"
          descriptionKey="pages.files.description"
        />
      );
    case "homework":
      return (
        <PagePlaceholder
          titleKey="pages.homework.title"
          descriptionKey="pages.homework.description"
        />
      );
    case "courses":
      return (
        <PagePlaceholder
          titleKey="pages.courses.title"
          descriptionKey="pages.courses.description"
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
  const [page, setPage] = useState<PageKey>("files");
  const { settings } = useSettings();

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
        <main className="flex-1 overflow-auto p-8">{renderPage(page)}</main>
      </div>
      <CloseConfirmDialog />
    </ThemeProvider>
  );
}
