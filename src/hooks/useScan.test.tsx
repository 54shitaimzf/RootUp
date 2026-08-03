import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useScan } from "./useScan";

vi.mock("../lib/tauri", () => ({
  getScanStatus: vi.fn(),
  scanAll: vi.fn(),
  cancelScan: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { cancelScan, getScanStatus, logEvent, scanAll } from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";

type Handler = (event: { payload: unknown }) => void;

describe("useScan", () => {
  let handlers: Record<string, Handler> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    vi.mocked(getScanStatus).mockResolvedValue({
      active: false,
      dir: null,
      discovered: 0,
      processed: 0,
      ignored: 0,
      errors: 0,
      queued: 0,
    });
    vi.mocked(scanAll).mockResolvedValue(undefined);
    vi.mocked(cancelScan).mockResolvedValue(undefined);
    vi.mocked(listen).mockImplementation((event, callback) => {
      handlers[event] = callback as Handler;
      return Promise.resolve(() => {});
    });
  });

  it("初始加载扫描状态", async () => {
    const { result } = renderHook(() => useScan());
    await waitFor(() =>
      expect(result.current.status).toMatchObject({ active: false }),
    );
  });

  it("scan-progress 更新状态", async () => {
    const { result } = renderHook(() => useScan());
    await waitFor(() => expect(handlers["scan-progress"]).toBeDefined());
    act(() => {
      handlers["scan-progress"]({
        payload: {
          type: "progress",
          progress: { dir: "C:/x", discovered: 10, processed: 4, ignored: 1, errors: 0 },
        },
      });
    });
    expect(result.current.status).toMatchObject({
      active: true,
      dir: "C:/x",
      processed: 4,
    });
  });

  it("scan-finished 记录摘要并结束", async () => {
    const { result } = renderHook(() => useScan());
    await waitFor(() => expect(handlers["scan-finished"]).toBeDefined());
    act(() => {
      handlers["scan-finished"]({
        payload: {
          type: "finished",
          summary: {
            discovered: 10,
            added: 8,
            updated: 2,
            ignored: 1,
            errors: 0,
            deleted: 0,
            elapsedMs: 100,
          },
        },
      });
    });
    expect(result.current.status).toMatchObject({ active: false });
    expect(result.current.lastSummary?.added).toBe(8);
  });

  it("scan-failed 记录错误", async () => {
    const { result } = renderHook(() => useScan());
    await waitFor(() => expect(handlers["scan-finished"]).toBeDefined());
    act(() => {
      handlers["scan-finished"]({ payload: { type: "failed", error: "boom" } });
    });
    expect(result.current.lastError).toBe("boom");
    expect(result.current.status).toMatchObject({ active: false });
  });

  it("startScanAll 与 cancel 调用后端命令", async () => {
    const { result } = renderHook(() => useScan());
    act(() => {
      result.current.startScanAll();
      result.current.cancel();
    });
    expect(scanAll).toHaveBeenCalledTimes(1);
    expect(cancelScan).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("info", "ui: 取消扫描");
  });
});
