import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FilePage } from "./FilePage";
import { SettingsProvider } from "../hooks/useSettings";
import { HelpCenterProvider } from "../components/HelpCenter";
import { ONBOARDING_STORAGE_KEY } from "../components/OnboardingDialog";
import type { ScanController } from "../hooks/useScan";
import { formatTimestamp } from "../lib/fileUtils";

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
  getStudyData,
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
      <HelpCenterProvider>
        <FilePage onNavigate={() => {}} scan={scan()} />
      </HelpCenterProvider>
    </SettingsProvider>,
  );
}

describe("FilePage 行操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
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
      nextCursor: null,
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
    expect(screen.getByLabelText("复制路径")).toBeInTheDocument();
    expect(screen.queryByLabelText("用 IDE 打开")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("智能打开"));
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
    vi.mocked(queryFiles).mockResolvedValue({
      items: [
        {
          id: 2,
          path: "C:/docs/main.rs",
          name: "main.rs",
          size: 100,
          file_type: "rs",
          labels: "",
          first_seen: 1,
          modified: 2,
          state: "indexed",
        },
      ],
      total: 1,
      nextCursor: null,
    });
    renderPage();
    await screen.findByText("main.rs");
    fireEvent.click(screen.getByLabelText("用 IDE 打开"));
    await waitFor(() =>
      expect(openProjectFromFile).toHaveBeenCalledWith("C:/docs/main.rs"),
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

  it("同名课程只显示一个标签：首标签完整、+N 折叠、无分割线、无日期", async () => {
    vi.mocked(getStudyData).mockResolvedValue({
      version: 1,
      semesters: [],
      coursesBySemester: {
        fall: [
          {
            id: "a",
            name: "高等数学",
            teacher: "王老师",
            location: "教 101",
            day: 1,
            startMin: 480,
            endMin: 600,
            weekRule: "all",
            labelKey: "course-a",
            color: "amber",
          },
          {
            id: "b",
            name: "高等数学",
            teacher: "李老师",
            location: "教 202",
            day: 2,
            startMin: 600,
            endMin: 700,
            weekRule: "all",
            labelKey: "course-b",
            color: "amber",
          },
        ],
      },
      homeworkBySemester: {},
    });
    vi.mocked(queryFiles).mockResolvedValue({
      items: [
        {
          id: 1,
          path: "C:/docs/高等数学/第1章.pdf",
          name: "高等数学-第1章.pdf",
          size: 100,
          file_type: "pdf",
          labels: "document,course-a,course-b",
          first_seen: 1,
          modified: 2,
          state: "indexed",
        },
      ],
      total: 1,
      nextCursor: null,
    });
    const { container } = renderPage();
    await screen.findByText("高等数学-第1章.pdf");
    await waitFor(() =>
      expect(screen.getAllByText("高等数学")).toHaveLength(1),
    );
    const firstChip = screen.getByText("高等数学").closest("span.rounded-full");
    expect(firstChip?.className ?? "").not.toContain("max-w-");
    const more = screen.getByText("+1");
    expect(more.getAttribute("title")).toContain("文档");
    const row = container.querySelector("li");
    expect(row?.querySelectorAll("span.w-px").length).toBe(0);
    expect(screen.queryByText(formatTimestamp(2))).not.toBeInTheDocument();
    expect(container.querySelector("li span.opacity-0")).not.toBeNull();
  });

  it("总数未知时显示已显示数量，有下一页时显示加载更多", async () => {
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
      total: -1,
      nextCursor: "[\"notes.pdf\",1]",
    });
    renderPage();
    expect(await screen.findByText("已显示 1 个")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "加载更多" }),
    ).toBeInTheDocument();
  });

  it("文件页只保留搜索框语法帮助，不出现重复的页头帮助按钮", async () => {
    renderPage();
    await screen.findByText("notes.pdf");
    expect(
      screen.queryByRole("button", { name: "查看本页帮助" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "搜索语法" }),
    ).toBeInTheDocument();
  });
});
