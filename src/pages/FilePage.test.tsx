import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FilePage } from "./FilePage";
import { SettingsProvider } from "../hooks/useSettings";
import type { ScanController } from "../hooks/useScan";

vi.mock("../lib/tauri", () => ({
  defaultSettings: {
    version: 2,
    theme: "system",
    language: "zh-CN",
    watched_dirs: [],
    ignore_rules: { extensions: [], prefixes: [], exact_names: [] },
    classify_overrides: [],
    project_dirs: [],
    preferred_ide: "auto",
    custom_open_commands: [],
    archive_root: "",
    auto_archive: false,
  },
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getStudyData: vi.fn(async () => ({
    version: 1,
    semesters: [],
    coursesBySemester: {},
    homeworkBySemester: {},
  })),
  queryFiles: vi.fn(),
  logEvent: vi.fn(),
  openFile: vi.fn(),
  revealInExplorer: vi.fn(),
  openProjectFromFile: vi.fn(),
  listCategories: vi.fn(),
  listLabelDefs: vi.fn(),
  listLabels: vi.fn(),
  listWatchedDirs: vi.fn(),
  archiveFiles: vi.fn(),
  archiveFiltered: vi.fn(),
  undoArchive: vi.fn(),
  getHabits: vi.fn(),
  saveHabits: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import {
  archiveFiles,
  archiveFiltered,
  getSettings,
  getHabits,
  listCategories,
  listLabelDefs,
  listLabels,
  listWatchedDirs,
  openFile,
  openProjectFromFile,
  queryFiles,
  revealInExplorer,
  saveHabits,
  undoArchive,
} from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";

function scan(): ScanController {
  return {
    status: null,
    lastSummary: null,
    lastError: null,
    startScanAll: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
  };
}

import type { Settings } from "../lib/tauri";

const SETTINGS: Settings = {
  version: 2,
  theme: "system",
  language: "zh-CN",
  watched_dirs: ["C:/docs"],
  ignore_rules: { extensions: [], prefixes: [], exact_names: [] },
  classify_overrides: [],
  project_dirs: [],
  preferred_ide: "auto",
  custom_open_commands: [],
      archive_root: "",
      auto_archive: false,
      close_action: "ask",
      reminder_enabled: false,
      reminder_lead_days: 3,
    };

function renderPage() {
  return render(
    <SettingsProvider>
      <FilePage onNavigate={() => {}} scan={scan()} />
    </SettingsProvider>,
  );
}

describe("FilePage 行操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryFiles).mockResolvedValue({
      items: [
        {
          id: 1,
          path: "C:/docs/notes.pdf",
          name: "notes.pdf",
          size: 100,
          file_type: "pdf",
          labels: "",
          first_seen: 1,
          modified: 2,
          state: "indexed",
        },
      ],
      total: 1,
    });
    vi.mocked(listCategories).mockResolvedValue(["document"]);
    vi.mocked(listLabelDefs).mockResolvedValue([]);
    vi.mocked(listLabels).mockResolvedValue([]);
    vi.mocked(listWatchedDirs).mockResolvedValue(["C:/docs"]);
    vi.mocked(getHabits).mockResolvedValue({});
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(saveHabits).mockResolvedValue(undefined);
    vi.mocked(openFile).mockResolvedValue({
      openedWith: "default",
      tool: null,
      message: null,
    });
    vi.mocked(revealInExplorer).mockResolvedValue(undefined);
    vi.mocked(openProjectFromFile).mockResolvedValue({
      openedWith: "ide",
      tool: "vscode",
      message: null,
    });
    vi.mocked(listen).mockImplementation((_event, _callback) =>
      Promise.resolve(() => {}),
    );
  });

  it("行内打开按钮调用 openFile", async () => {
    renderPage();
    expect(await screen.findByText("notes.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("用 IDE/工具打开"));
    await waitFor(() =>
      expect(openFile).toHaveBeenCalledWith("C:/docs/notes.pdf"),
    );
  });

  it("行内定位按钮调用 revealInExplorer", async () => {
    renderPage();
    await screen.findByText("notes.pdf");
    fireEvent.click(screen.getByLabelText("在资源管理器中显示"));
    await waitFor(() =>
      expect(revealInExplorer).toHaveBeenCalledWith("C:/docs/notes.pdf"),
    );
  });

  it("行内用 IDE 打开调用 openProjectFromFile", async () => {
    renderPage();
    await screen.findByText("notes.pdf");
    fireEvent.click(screen.getByLabelText("用 IDE 打开"));
    await waitFor(() =>
      expect(openProjectFromFile).toHaveBeenCalledWith("C:/docs/notes.pdf"),
    );
  });

  it("归档根配置后单文件归档并显示撤销提示", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...SETTINGS,
      archive_root: "C:/Archive",
    });
    vi.mocked(archiveFiles).mockResolvedValue({
      batchId: 1,
      archived: 1,
      failed: [],
    });
    renderPage();
    await screen.findByText("notes.pdf");
    fireEvent.click(screen.getByLabelText("归档"));
    await waitFor(() =>
      expect(archiveFiles).toHaveBeenCalledWith(["C:/docs/notes.pdf"]),
    );
    expect(await screen.findByText(/已归档 1 个文件/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(undoArchive).toHaveBeenCalledWith(1));
  });

  it("批量模式复选后严格确认再归档所选", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...SETTINGS,
      archive_root: "C:/Archive",
    });
    vi.mocked(archiveFiles).mockResolvedValue({
      batchId: 2,
      archived: 1,
      failed: [],
    });
    renderPage();
    await screen.findByText("notes.pdf");
    fireEvent.click(screen.getByRole("button", { name: "批量" }));
    fireEvent.click(screen.getByLabelText("选择文件"));
    fireEvent.click(screen.getByRole("button", { name: "归档所选" }));
    fireEvent.click(screen.getByRole("button", { name: "归档 1 个文件" }));
    await waitFor(() =>
      expect(archiveFiles).toHaveBeenCalledWith(["C:/docs/notes.pdf"]),
    );
  });

  it("筛选生效时显示归档当前筛选按钮并调用后端", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...SETTINGS,
      archive_root: "C:/Archive",
    });
    vi.mocked(archiveFiltered).mockResolvedValue({
      batchId: 3,
      archived: 1,
      failed: [],
    });
    renderPage();
    await screen.findByText("notes.pdf");
    fireEvent.change(screen.getByPlaceholderText("搜索文件…"), {
      target: { value: "pdf" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /归档当前筛选/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /归档当前筛选/ }));
    fireEvent.click(screen.getByRole("button", { name: "归档 1 个文件" }));
    await waitFor(() => expect(archiveFiltered).toHaveBeenCalled());
  });

  it("自动归档开启时显示常驻提示并可关闭", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...SETTINGS,
      archive_root: "C:/Archive",
      auto_archive: true,
    });
    renderPage();
    expect(await screen.findByText(/自动归档已开启/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.queryByText(/自动归档已开启/)).not.toBeInTheDocument();
  });
});
