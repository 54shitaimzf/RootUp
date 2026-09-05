import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArchiveSettingsDialog } from "./ArchiveSettingsDialog";

vi.mock("../../../lib/tauri", () => ({
  listArchiveBatches: vi.fn(),
  undoArchive: vi.fn(),
  openDirectoryDialog: vi.fn(),
  assessArchiveRoot: vi.fn(),
  recommendedArchiveRoots: vi.fn(),
}));

import {
  assessArchiveRoot,
  listArchiveBatches,
  openDirectoryDialog,
  recommendedArchiveRoots,
  undoArchive,
} from "../../../lib/tauri";

function renderDialog(
  overrides: Partial<Parameters<typeof ArchiveSettingsDialog>[0]> = {},
) {
  const props = {
    open: true,
    root: "",
    autoArchive: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ArchiveSettingsDialog {...props} />);
  return props;
}

describe("ArchiveSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listArchiveBatches).mockResolvedValue([]);
    vi.mocked(assessArchiveRoot).mockResolvedValue({
      level: "safe",
      reason: null,
    });
    vi.mocked(recommendedArchiveRoots).mockResolvedValue([]);
    vi.mocked(undoArchive).mockResolvedValue({
      batchId: 1,
      archived: 1,
      failed: [],
      results: [],
    });
  });

  it("保存归档根与自动归档开关（开启需确认后果）", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSave });
    fireEvent.change(screen.getByPlaceholderText("如：D:\\Archive"), {
      target: { value: "C:/Archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开启自动归档" }));
    // 开启方向弹出危险确认，确认后才生效
    expect(
      screen.getByText("开启后，新出现且分类明确的文件将自动移入档案库，不再逐个确认；跨磁盘或被占用的文件会保留原位并提示失败。可随时回到这里关闭。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "仍要开启" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        archive_root: "C:/Archive",
        auto_archive: true,
      }),
    );
  });

  it("危险位置（盘根）即时告警并禁用保存", async () => {
    vi.mocked(assessArchiveRoot).mockResolvedValue({
      level: "blocked",
      reason: "drive_root",
    });
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText("如：D:\\Archive"), {
      target: { value: "D:/" },
    });
    // 防抖评估落定
    expect(await screen.findByText(/不能选择磁盘根目录/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(assessArchiveRoot).toHaveBeenCalledWith("D:/");
  });

  it("常用目录（warn）保存需二次确认", async () => {
    vi.mocked(assessArchiveRoot).mockResolvedValue({
      level: "warn",
      reason: "user_core_dir",
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSave });
    fireEvent.change(screen.getByPlaceholderText("如：D:\\Archive"), {
      target: { value: "C:/Users/X/Downloads" },
    });
    expect(await screen.findByText(/档案库会与日常文件混放/)).toBeInTheDocument();
    // 第一次点保存 → 确认弹层；确认后才落盘
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        archive_root: "C:/Users/X/Downloads",
        auto_archive: false,
      }),
    );
  });

  it("推荐位置候选点击回填输入框", async () => {
    vi.mocked(recommendedArchiveRoots).mockResolvedValue([
      "C:/Users/X/Documents/RootUp 档案库",
    ]);
    renderDialog();
    const chip = await screen.findByRole("button", {
      name: "C:/Users/X/Documents/RootUp 档案库",
    });
    fireEvent.click(chip);
    expect(
      (screen.getByPlaceholderText("如：D:\\Archive") as HTMLInputElement).value,
    ).toBe("C:/Users/X/Documents/RootUp 档案库");
  });

  it("最近归档批次可撤销并刷新列表", async () => {
    vi.mocked(listArchiveBatches).mockResolvedValue([
      {
        batchId: 7,
        kind: "file",
        count: 2,
        createdAt: 1000,
        undone: false,
        sampleDest: "C:/Archive/document/a.pdf",
      },
    ]);
    renderDialog();
    expect(await screen.findByText(/个文件/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("撤销"));
    await waitFor(() => expect(undoArchive).toHaveBeenCalledWith(7));
    await waitFor(() => expect(listArchiveBatches).toHaveBeenCalledTimes(2));
  });

  it("保存失败展示错误", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("归档根不能与监控目录相同"));
    renderDialog({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText(/归档根不能与监控目录相同/)).toBeInTheDocument();
  });

  it("浏览按钮经目录选择器回填归档根", async () => {
    vi.mocked(openDirectoryDialog).mockResolvedValue("D:/Picked/Root");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText("如：D:\\Archive") as HTMLInputElement).value,
      ).toBe("D:/Picked/Root"),
    );
  });

  it("浏览取消选择不改动手输路径", async () => {
    vi.mocked(openDirectoryDialog).mockResolvedValue(null);
    renderDialog({ root: "C:/Keep" });
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(openDirectoryDialog).toHaveBeenCalled());
    expect(
      (screen.getByPlaceholderText("如：D:\\Archive") as HTMLInputElement).value,
    ).toBe("C:/Keep");
  });
});
