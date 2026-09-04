import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { SettingsProvider } from "../hooks/useSettings";
import { ThemeProvider } from "../theme/ThemeProvider";
import { HelpCenterProvider } from "../components/HelpCenter";
import { ONBOARDING_STORAGE_KEY } from "../components/OnboardingDialog";
import type { ScanController } from "../hooks/useScan";
import type { Settings } from "../lib/tauri";

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

vi.mock("../lib/tauri", () => ({
  DEFAULT_IGNORE_RULES: {
    extensions: ["crdownload", "part", "download", "tmp", "temp"],
    prefixes: ["~$"],
    exact_names: ["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"],
  },
  defaultSettings: {
    version: 3,
    theme: "system",
    language: "zh-CN",
    watched_dirs: [],
    ignore_rules: {
      extensions: ["crdownload", "part", "download", "tmp", "temp"],
      prefixes: ["~$"],
      exact_names: ["desktop.ini", "thumbs.db", ".ds_store", "$recycle.bin"],
    },
    classify_overrides: [],
    project_dirs: [],
    preferred_ide: "auto",
    custom_open_commands: [],
    archive_root: "",
    auto_archive: false,
  },
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  addWatchedDir: vi.fn(),
  removeWatchedDir: vi.fn(),
  countUnderRoot: vi.fn(),
  listCommonDirs: vi.fn(),
  resolveDirTarget: vi.fn(),
  openDirectoryDialog: vi.fn(),
  createHomeworkShortcut: vi.fn(),
  resetSettings: vi.fn(),
  getLogDir: vi.fn(),
  listCategories: vi.fn(),
  listLabelDefs: vi.fn(),
  listClassifyDefaults: vi.fn(),
  listSchemes: vi.fn(),
  listArchiveBatches: vi.fn(),
  undoArchive: vi.fn(),
  listWatchedDirs: vi.fn(),
  watchedDirHealth: vi.fn(),
  logEvent: vi.fn(),
}));

import {
  addWatchedDir,
  countUnderRoot,
  createHomeworkShortcut,
  listCommonDirs,
  openDirectoryDialog,
  removeWatchedDir,
  resolveDirTarget,
  getLogDir,
  getSettings,
  listCategories,
  listLabelDefs,
  listClassifyDefaults,
  listArchiveBatches,
  listSchemes,
  listWatchedDirs,
  watchedDirHealth,
  resetSettings,
  saveSettings,
  undoArchive,
} from "../lib/tauri";

const SETTINGS: Settings = {
  version: 1,
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
      close_action: "ask",
      reminder_enabled: false,
      reminder_lead_days: 3,
    };

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

function renderPage() {
  return render(
    <SettingsProvider>
      <ThemeProvider>
        <HelpCenterProvider>
          <SettingsPage scan={scan()} />
        </HelpCenterProvider>
      </ThemeProvider>
    </SettingsProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(saveSettings).mockResolvedValue(undefined);
    vi.mocked(listWatchedDirs).mockResolvedValue([]);
    vi.mocked(watchedDirHealth).mockResolvedValue([]);
    vi.mocked(getLogDir).mockResolvedValue("C:/logs");
    vi.mocked(listCategories).mockResolvedValue(["document", "image"]);
    vi.mocked(listLabelDefs).mockResolvedValue([]);
    vi.mocked(listClassifyDefaults).mockResolvedValue([]);
    vi.mocked(listSchemes).mockResolvedValue([]);
    vi.mocked(listArchiveBatches).mockResolvedValue([]);
    vi.mocked(listCommonDirs).mockResolvedValue([]);
    vi.mocked(countUnderRoot).mockResolvedValue(0);
    vi.mocked(resolveDirTarget).mockImplementation(async (path) => path);
    vi.mocked(openDirectoryDialog).mockResolvedValue(null);
    vi.mocked(removeWatchedDir).mockResolvedValue(undefined);
    vi.mocked(addWatchedDir).mockImplementation(async (dir) => ({
      dir,
      message: null,
    }));
    vi.mocked(undoArchive).mockResolvedValue({
      batchId: 1,
      archived: 1,
      failed: [],
    });
  });

  it("渲染规则三行入口", async () => {
    renderPage();
    expect(
      await screen.findByText("规则方案"),
    ).toBeInTheDocument();
    expect(screen.getByText("忽略规则")).toBeInTheDocument();
    expect(screen.getByText("分类映射")).toBeInTheDocument();
  });

  it("语言下拉切换写回设置", async () => {
    renderPage();
    await screen.findByLabelText("语言");
    fireEvent.click(screen.getByLabelText("语言"));
    fireEvent.click(screen.getByRole("option", { name: /English/ }));
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en" }),
      ),
    );
  });

  it("学业提醒开关与桌面快捷方式", async () => {
    renderPage();
    await screen.findByText("作业截止提醒");
    const leadSelect = screen.getByLabelText("提前提醒天数");
    expect(leadSelect).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ reminder_enabled: true }),
      ),
    );
    await waitFor(() => expect(leadSelect).not.toBeDisabled());

    vi.mocked(createHomeworkShortcut).mockResolvedValue({
      path: "C:/Users/x/Desktop/打开未完成作业 (RootUp).lnk",
      name: "打开未完成作业 (RootUp)",
      kind: "homework",
    });
    fireEvent.click(screen.getByRole("button", { name: "创建快捷方式" }));
    expect(createHomeworkShortcut).toHaveBeenCalled();
    expect(await screen.findByText("已创建桌面快捷方式")).toBeInTheDocument();
  });

  it("常用目录一键添加", async () => {
    vi.mocked(listCommonDirs).mockResolvedValue([
      { path: "C:/Users/x/Downloads", kind: "downloads" },
    ]);
    renderPage();
    const chip = await screen.findByText("下载");
    fireEvent.click(chip);
    await waitFor(() =>
      expect(addWatchedDir).toHaveBeenCalledWith("C:/Users/x/Downloads"),
    );
  });

  it("浏览目录选择后直接添加", async () => {
    vi.mocked(openDirectoryDialog).mockResolvedValue("C:/Picked");
    renderPage();
    await screen.findByLabelText("语言");
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() =>
      expect(addWatchedDir).toHaveBeenCalledWith("C:/Picked"),
    );
  });

  it("拖拽文件夹触发添加（文件取父目录由后端解析）", async () => {
    renderPage();
    await screen.findByLabelText("语言");
    await waitFor(() => expect(dragMock.handler).toBeDefined());
    dragMock.handler?.({
      type: "drop",
      payload: { type: "drop", paths: ["C:/Drop/notes.pdf"] },
    });
    await waitFor(() =>
      expect(resolveDirTarget).toHaveBeenCalledWith("C:/Drop/notes.pdf"),
    );
    await waitFor(() =>
      expect(addWatchedDir).toHaveBeenCalledWith("C:/Drop/notes.pdf"),
    );
  });

  it("移除目录先取数再确认，确认后调用移除", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...SETTINGS,
      watched_dirs: ["C:/Watch"],
    });
    vi.mocked(countUnderRoot).mockResolvedValue(3);
    renderPage();
    const removeButtons = await screen.findAllByRole("button", {
      name: "移除",
    });
    fireEvent.click(removeButtons[0]);
    expect(await screen.findByText(/约 3 个文件/)).toBeInTheDocument();
    const confirms = screen.getAllByRole("button", { name: "移除" });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() =>
      expect(removeWatchedDir).toHaveBeenCalledWith("C:/Watch"),
    );
  });

  it("取消移除不调用移除命令", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...SETTINGS,
      watched_dirs: ["C:/Watch"],
    });
    renderPage();
    const removeButtons = await screen.findAllByRole("button", {
      name: "移除",
    });
    fireEvent.click(removeButtons[0]);
    await screen.findByText(/约 0 个文件/);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(removeWatchedDir).not.toHaveBeenCalled();
  });

  it("忽略规则与分类映射弹窗可开关", async () => {
    renderPage();
    const editButtons = await screen.findAllByText("编辑");
    fireEvent.click(editButtons[0]);
    expect(
      screen.getByRole("dialog", { name: "编辑忽略规则" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(editButtons[1]);
    expect(
      screen.getByRole("dialog", { name: "编辑分类映射" }),
    ).toBeInTheDocument();
  });

  it("归档设置弹窗可保存归档根与自动归档开关", async () => {
    renderPage();
    const archiveRow = (await screen.findByText("归档设置")).closest(
      '[role="button"]',
    ) as HTMLElement;
    fireEvent.click(within(archiveRow).getByRole("button", { name: "编辑" }));
    expect(
      screen.getByRole("dialog", { name: "归档设置" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("如：D:\\Archive"), {
      target: { value: "C:/Archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开启自动归档" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          archive_root: "C:/Archive",
          auto_archive: true,
        }),
      );
    });
  });

  it("添加监控目录后保存归档设置不丢目录（单一数据源回归）", async () => {
    renderPage();
    await screen.findByLabelText("语言");
    fireEvent.change(
      screen.getByPlaceholderText("输入目录路径，如 D:\\Downloads"),
      { target: { value: "C:/NewWatch" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() =>
      expect(addWatchedDir).toHaveBeenCalledWith("C:/NewWatch"),
    );
    const archiveRow = (await screen.findByText("归档设置")).closest(
      '[role="button"]',
    ) as HTMLElement;
    fireEvent.click(within(archiveRow).getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("如：D:\\Archive"), {
      target: { value: "C:/Archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          archive_root: "C:/Archive",
          watched_dirs: expect.arrayContaining(["C:/NewWatch"]),
        }),
      );
    });
  });

  it("点击设置行打开说明弹窗，编辑按钮打开编辑弹窗且互不干扰", async () => {
    renderPage();
    const ignoreRow = (await screen.findByText("忽略规则")).closest(
      '[role="button"]',
    ) as HTMLElement;
    fireEvent.click(ignoreRow);
    expect(
      screen.getByRole("dialog", { name: "忽略规则" }),
    ).toBeInTheDocument();
    expect(screen.getByText("功能介绍")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "编辑忽略规则" })).not.toBeInTheDocument();

    const closeButtons = screen.getAllByRole("button", { name: "关闭" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(ignoreRow).getByRole("button", { name: "编辑" }));
    expect(
      screen.getByRole("dialog", { name: "编辑忽略规则" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("功能介绍")).not.toBeInTheDocument();
  });

  it("应用方案与保存方案弹窗可打开", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("应用方案…"));
    expect(
      screen.getByRole("dialog", { name: "应用方案" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("关闭"));

    fireEvent.click(screen.getByText("保存为方案…"));
    expect(
      screen.getByRole("dialog", { name: "保存为方案" }),
    ).toBeInTheDocument();
  });

  it("重置走确认弹窗并调用 resetSettings", async () => {
    vi.mocked(resetSettings).mockResolvedValue(SETTINGS);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "恢复默认设置" }),
    );
    const dialog = screen.getByRole("dialog", { name: "恢复默认设置" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "恢复默认设置" }),
    );
    await waitFor(() => expect(resetSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalled();
  });

  it("添加目录失败显示 dirError 且不显示 notice", async () => {
    vi.mocked(addWatchedDir).mockRejectedValue("目录不存在: C:/nope");
    renderPage();
    const input = await screen.findByPlaceholderText("输入目录路径，如 D:\\Downloads");
    fireEvent.change(input, { target: { value: "C:/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const error = await screen.findByText("目录不存在: C:/nope");
    expect(error).toBeInTheDocument();
    expect(screen.queryByText("已添加，正在扫描该目录")).not.toBeInTheDocument();
  });

  it("添加目录成功用返回的规范化路径更新列表并显示 notice", async () => {
    vi.mocked(addWatchedDir).mockResolvedValue({
      message: "已添加，正在扫描该目录",
      dir: "c:/users/x",
    });
    renderPage();
    const input = await screen.findByPlaceholderText("输入目录路径，如 D:\\Downloads");
    fireEvent.change(input, { target: { value: "C:/Users/X" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByText("c:/users/x")).toBeInTheDocument();
    expect(addWatchedDir).toHaveBeenCalledWith("C:/Users/X");
  });

  it("重置失败显示 ruleError", async () => {
    vi.mocked(resetSettings).mockRejectedValue("重置失败");
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "恢复默认设置" }),
    );
    const dialog = screen.getByRole("dialog", { name: "恢复默认设置" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "恢复默认设置" }),
    );
    expect(await screen.findByText("重置失败")).toBeInTheDocument();
  });
});
