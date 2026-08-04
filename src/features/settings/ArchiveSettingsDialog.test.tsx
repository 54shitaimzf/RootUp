import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArchiveSettingsDialog } from "./ArchiveSettingsDialog";

vi.mock("../../lib/tauri", () => ({
  listArchiveBatches: vi.fn(),
  undoArchive: vi.fn(),
}));

import { listArchiveBatches, undoArchive } from "../../lib/tauri";

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
    vi.mocked(undoArchive).mockResolvedValue({
      batchId: 1,
      archived: 1,
      failed: [],
    });
  });

  it("保存归档根与自动归档开关", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSave });
    fireEvent.change(screen.getByPlaceholderText("如：D:\\Archive"), {
      target: { value: "C:/Archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开启自动归档" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        archive_root: "C:/Archive",
        auto_archive: true,
      }),
    );
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
});
