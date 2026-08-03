import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FilePage } from "./FilePage";
import type { ScanController } from "../hooks/useScan";

vi.mock("../lib/tauri", () => ({
  queryFiles: vi.fn(),
  logEvent: vi.fn(),
  openFile: vi.fn(),
  revealInExplorer: vi.fn(),
  openProjectFromFile: vi.fn(),
  listCategories: vi.fn(),
  listLabels: vi.fn(),
  listWatchedDirs: vi.fn(),
  getHabits: vi.fn(),
  saveHabits: vi.fn(),
  defaultSettings: {},
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import {
  getHabits,
  listCategories,
  listLabels,
  listWatchedDirs,
  openFile,
  openProjectFromFile,
  queryFiles,
  revealInExplorer,
  saveHabits,
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
    vi.mocked(listLabels).mockResolvedValue([]);
    vi.mocked(listWatchedDirs).mockResolvedValue(["C:/docs"]);
    vi.mocked(getHabits).mockResolvedValue({});
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
    render(<FilePage onNavigate={() => {}} scan={scan()} />);
    expect(await screen.findByText("notes.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("用 IDE/工具打开"));
    await waitFor(() =>
      expect(openFile).toHaveBeenCalledWith("C:/docs/notes.pdf"),
    );
  });

  it("行内定位按钮调用 revealInExplorer", async () => {
    render(<FilePage onNavigate={() => {}} scan={scan()} />);
    await screen.findByText("notes.pdf");
    fireEvent.click(screen.getByLabelText("在资源管理器中显示"));
    await waitFor(() =>
      expect(revealInExplorer).toHaveBeenCalledWith("C:/docs/notes.pdf"),
    );
  });

  it("行内用 IDE 打开调用 openProjectFromFile", async () => {
    render(<FilePage onNavigate={() => {}} scan={scan()} />);
    await screen.findByText("notes.pdf");
    fireEvent.click(screen.getByLabelText("用 IDE 打开"));
    await waitFor(() =>
      expect(openProjectFromFile).toHaveBeenCalledWith("C:/docs/notes.pdf"),
    );
  });
});
