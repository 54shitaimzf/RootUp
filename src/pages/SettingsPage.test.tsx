import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { SettingsProvider } from "../hooks/useSettings";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { ScanController } from "../hooks/useScan";
import type { Settings } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  defaultSettings: {
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
  },
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  addWatchedDir: vi.fn(),
  removeWatchedDir: vi.fn(),
  resetSettings: vi.fn(),
  getLogDir: vi.fn(),
  listCategories: vi.fn(),
  listLabelDefs: vi.fn(),
  listClassifyDefaults: vi.fn(),
  listSchemes: vi.fn(),
  listArchiveBatches: vi.fn(),
  undoArchive: vi.fn(),
  listWatchedDirs: vi.fn(),
  logEvent: vi.fn(),
}));

import {
  addWatchedDir,
  getLogDir,
  getSettings,
  listCategories,
  listLabelDefs,
  listClassifyDefaults,
  listArchiveBatches,
  listSchemes,
  listWatchedDirs,
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
        <SettingsPage scan={scan()} />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue(SETTINGS);
    vi.mocked(saveSettings).mockResolvedValue(undefined);
    vi.mocked(listWatchedDirs).mockResolvedValue([]);
    vi.mocked(getLogDir).mockResolvedValue("C:/logs");
    vi.mocked(listCategories).mockResolvedValue(["document", "image"]);
    vi.mocked(listLabelDefs).mockResolvedValue([]);
    vi.mocked(listClassifyDefaults).mockResolvedValue([]);
    vi.mocked(listSchemes).mockResolvedValue([]);
    vi.mocked(listArchiveBatches).mockResolvedValue([]);
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
    fireEvent.click(await screen.findByText("归档设置"));
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
