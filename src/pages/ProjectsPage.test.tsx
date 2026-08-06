import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectsPage } from "./ProjectsPage";
import { SettingsProvider } from "../hooks/useSettings";
import { HelpCenterProvider } from "../components/HelpCenter";
import { ONBOARDING_STORAGE_KEY } from "../components/OnboardingDialog";

vi.mock("../lib/tauri", () => ({
  defaultSettings: {
    version: 1,
    theme: "system",
    language: "zh-CN",
    watched_dirs: [],
    ignore_rules: { extensions: [], prefixes: [], exact_names: [] },
    classify_overrides: [],
    project_dirs: ["E:/manual"],
    preferred_ide: "auto",
    custom_open_commands: [],
    archive_root: "",
    auto_archive: false,
  },
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  archiveProject: vi.fn(),
  undoArchive: vi.fn(),
  listProjects: vi.fn(),
  listCommonDirs: vi.fn(),
  listDetectedTools: vi.fn(),
  openDirectoryDialog: vi.fn(),
  resolveDirTarget: vi.fn(),
  addProjectDir: vi.fn(),
  removeProjectDir: vi.fn(),
  openProject: vi.fn(),
  revealInExplorer: vi.fn(),
  createProjectShortcut: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const dragMock = vi.hoisted(() => ({
  handler: undefined as
    | ((event: {
        type: string;
        payload: { type: string; paths: string[] };
      }) => void)
    | undefined,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler: typeof dragMock.handler) => {
      dragMock.handler = handler;
      return () => {};
    }),
  }),
}));

import {
  addProjectDir,
  archiveProject,
  createProjectShortcut,
  getSettings,
  listCommonDirs,
  listProjects,
  listDetectedTools,
  openDirectoryDialog,
  openProject,
  removeProjectDir,
  resolveDirTarget,
  saveSettings,
  undoArchive,
} from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";

function renderPage() {
  return render(
    <SettingsProvider>
      <HelpCenterProvider>
        <ProjectsPage onNavigate={() => {}} />
      </HelpCenterProvider>
    </SettingsProvider>,
  );
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    vi.mocked(getSettings).mockResolvedValue({
      version: 1,
      theme: "system",
      language: "zh-CN",
      watched_dirs: [],
      ignore_rules: { extensions: [], prefixes: [], exact_names: [] },
      classify_overrides: [],
      project_dirs: ["E:/manual"],
      preferred_ide: "auto",
      custom_open_commands: [],
      archive_root: "",
      auto_archive: false,
      close_action: "ask",
      reminder_enabled: false,
      reminder_lead_days: 3,
    });
    vi.mocked(saveSettings).mockResolvedValue(undefined);
    vi.mocked(listProjects).mockResolvedValue([
      {
        path: "C:/proj/rust-app",
        name: "rust-app",
        kind: "rust",
        source: "auto",
        detectedBy: "Cargo.toml",
      },
      {
        path: "E:/manual",
        name: "manual",
        kind: "generic",
        source: "manual",
        detectedBy: null,
      },
    ]);
    vi.mocked(listCommonDirs).mockResolvedValue([]);
    vi.mocked(openDirectoryDialog).mockResolvedValue(null);
    vi.mocked(resolveDirTarget).mockImplementation(async (path) => path);
    vi.mocked(listDetectedTools).mockResolvedValue(["vscode"]);
    vi.mocked(openProject).mockResolvedValue({
      openedWith: "ide",
      tool: "vscode",
      message: null,
    });
    vi.mocked(createProjectShortcut).mockResolvedValue({
      path: "C:/Users/t/Desktop/rust-app.lnk",
      name: "rust-app",
      kind: "rust",
    });
    vi.mocked(archiveProject).mockResolvedValue({
      batchId: 10,
      archived: 1,
      failed: [],
    });
    vi.mocked(undoArchive).mockResolvedValue({
      batchId: 10,
      archived: 1,
      failed: [],
    });
    vi.mocked(listen).mockImplementation((_event, _callback) =>
      Promise.resolve(() => {}),
    );
  });

  it("渲染项目列表与类型标签", async () => {
    renderPage();
    expect(await screen.findByText("rust-app")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("Rust")).toBeInTheDocument();
    expect(screen.getByText("C:/proj/rust-app")).toBeInTheDocument();
  });

  it("空态引导去设置页", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    const onNavigate = vi.fn();
    render(
      <SettingsProvider>
        <HelpCenterProvider>
          <ProjectsPage onNavigate={onNavigate} />
        </HelpCenterProvider>
      </SettingsProvider>,
    );
    fireEvent.click(await screen.findByText("去设置页添加监控目录"));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("配置归档根后项目可归档并撤销", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      version: 2,
      theme: "system",
      language: "zh-CN",
      watched_dirs: [],
      ignore_rules: { extensions: [], prefixes: [], exact_names: [] },
      classify_overrides: [],
      project_dirs: ["E:/manual"],
      preferred_ide: "auto",
      custom_open_commands: [],
      archive_root: "C:/Archive",
      auto_archive: false,
      close_action: "ask",
      reminder_enabled: false,
      reminder_lead_days: 3,
    });
    renderPage();
    await screen.findByText("rust-app");
    fireEvent.click(screen.getAllByLabelText("归档")[0]);
    fireEvent.click(screen.getByRole("button", { name: "归档项目" }));
    await waitFor(() =>
      expect(archiveProject).toHaveBeenCalledWith("C:/proj/rust-app"),
    );
    expect(await screen.findByText(/已归档 1 个项目/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(undoArchive).toHaveBeenCalledWith(10));
  });

  it("添加项目目录并刷新", async () => {
    renderPage();
    const input = await screen.findByPlaceholderText("输入项目目录路径");
    fireEvent.change(input, { target: { value: "D:/proj" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() =>
      expect(addProjectDir).toHaveBeenCalledWith("D:/proj"),
    );
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("渲染来源徽章与识别依据", async () => {
    renderPage();
    await screen.findByText("rust-app");
    expect(screen.getByText("自动")).toBeInTheDocument();
    expect(screen.getByText("识别依据：Cargo.toml")).toBeInTheDocument();
    expect(screen.getByText("手动")).toBeInTheDocument();
    expect(screen.queryByText("识别依据：")).not.toBeInTheDocument();
  });

  it("浏览选择目录后添加项目", async () => {
    vi.mocked(openDirectoryDialog).mockResolvedValue("D:/picked");
    renderPage();
    await screen.findByPlaceholderText("输入项目目录路径");
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() =>
      expect(addProjectDir).toHaveBeenCalledWith("D:/picked"),
    );
  });

  it("拖拽文件夹触发添加（文件取父目录）", async () => {
    renderPage();
    await waitFor(() => expect(dragMock.handler).toBeDefined());
    dragMock.handler?.({
      type: "drop",
      payload: { type: "drop", paths: ["C:/Drop/proj/notes.pdf"] },
    });
    await waitFor(() =>
      expect(resolveDirTarget).toHaveBeenCalledWith("C:/Drop/proj/notes.pdf"),
    );
    await waitFor(() =>
      expect(addProjectDir).toHaveBeenCalledWith("C:/Drop/proj/notes.pdf"),
    );
  });

  it("常用目录一键添加项目", async () => {
    vi.mocked(listCommonDirs).mockResolvedValue([
      { path: "C:/Users/x/Downloads", kind: "downloads" },
    ]);
    renderPage();
    const chip = await screen.findByText("下载");
    fireEvent.click(chip);
    await waitFor(() =>
      expect(addProjectDir).toHaveBeenCalledWith("C:/Users/x/Downloads"),
    );
  });

  it("添加项目失败显示错误", async () => {
    vi.mocked(addProjectDir).mockRejectedValue("目录不存在: D:/nope");
    renderPage();
    const input = await screen.findByPlaceholderText("输入项目目录路径");
    fireEvent.change(input, { target: { value: "D:/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByText("目录不存在: D:/nope")).toBeInTheDocument();
  });

  it("打开项目调用 openProject", async () => {
    renderPage();
    const buttons = await screen.findAllByLabelText("用 IDE/工具打开");
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith("C:/proj/rust-app"),
    );
  });

  it("创建桌面快捷方式并提示", async () => {
    renderPage();
    const buttons = await screen.findAllByLabelText("创建桌面快捷方式");
    fireEvent.click(buttons[0]);
    expect(
      await screen.findByText("桌面快捷方式已创建：rust-app"),
    ).toBeInTheDocument();
  });

  it("手动项目可两步确认移除", async () => {
    renderPage();
    const remove = await screen.findByLabelText("移除");
    fireEvent.click(remove);
    fireEvent.click(screen.getByText("确认移除？"));
    await waitFor(() =>
      expect(removeProjectDir).toHaveBeenCalledWith("E:/manual"),
    );
  });

  it("检测到代码项目但无 IDE 时显示引导条", async () => {
    vi.mocked(listDetectedTools).mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(
        "检测到代码项目，但未找到可用的 IDE。点此了解如何安装。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("了解如何安装 IDE")).toBeInTheDocument();
  });

  it("检测到 IDE 时不显示引导条", async () => {
    renderPage();
    await screen.findByText("rust-app");
    expect(
      screen.queryByText(
        "检测到代码项目，但未找到可用的 IDE。点此了解如何安装。",
      ),
    ).not.toBeInTheDocument();
  });
});
