import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFiles } from "./useFiles";
import type { FileRecord, QueryPage } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  queryFiles: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { queryFiles } from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";

function rec(
  path: string,
  modified: number,
  state: FileRecord["state"] = "indexed",
): FileRecord {
  const name = path.split("/").pop() ?? path;
  return {
    id: 0,
    path,
    name,
    size: 100,
    file_type: "txt",
    labels: "",
    first_seen: modified,
    modified,
    state,
  };
}

function page(items: FileRecord[], total: number): QueryPage {
  return { items, total };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type EventHandler = (event: { payload: FileRecord[] }) => void;

describe("useFiles", () => {
  let eventHandler: EventHandler | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = undefined;
    vi.mocked(listen).mockImplementation((_event, callback) => {
      eventHandler = callback as EventHandler;
      return Promise.resolve(() => {});
    });
  });

  it("offset=0 时整体替换列表", async () => {
    const d = deferred<QueryPage>();
    vi.mocked(queryFiles).mockReturnValue(d.promise);
    const { result } = renderHook((props) => useFiles("", 50, props.offset, props.refreshKey), {
      initialProps: { offset: 0, refreshKey: 0 },
    });
    await act(async () => {
      d.resolve(page([rec("C:/a.txt", 2)], 10));
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.total).toBe(10);
    expect(result.current.loading).toBe(false);
  });

  it("加载更多按 offset 追加去重", async () => {
    const first = deferred<QueryPage>();
    const second = deferred<QueryPage>();
    vi.mocked(queryFiles)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      (props) => useFiles("", 50, props.offset, props.refreshKey),
      { initialProps: { offset: 0, refreshKey: 0 } },
    );
    await act(async () => {
      first.resolve(page([rec("C:/a.txt", 1)], 2));
    });
    rerender({ offset: 50, refreshKey: 0 });
    await act(async () => {
      second.resolve(page([rec("C:/b.txt", 3), rec("C:/a.txt", 2)], 2));
    });
    expect(result.current.items.map((f) => f.path)).toEqual([
      "C:/b.txt",
      "C:/a.txt",
    ]);
  });

  it("实时事件合并不把已加载的更多页截回 limit（回归）", async () => {
    const first = deferred<QueryPage>();
    const second = deferred<QueryPage>();
    const third = deferred<QueryPage>();
    vi.mocked(queryFiles)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { result, rerender } = renderHook(
      (props) => useFiles("", 50, props.offset, props.refreshKey),
      { initialProps: { offset: 0, refreshKey: 0 } },
    );
    await act(async () => {
      first.resolve(
        page(Array.from({ length: 50 }, (_, i) => rec(`C:/f${i}.txt`, i)), 100),
      );
    });
    rerender({ offset: 50, refreshKey: 0 });
    await act(async () => {
      second.resolve(
        page(
          Array.from({ length: 50 }, (_, i) => rec(`C:/g${i}.txt`, 100 + i)),
          100,
        ),
      );
    });
    expect(result.current.items).toHaveLength(100);

    // 回到首页并触发新查询（挂起），期间实时事件到达
    rerender({ offset: 0, refreshKey: 1 });
    await waitFor(() => expect(eventHandler).toBeDefined());
    act(() => {
      eventHandler!({ payload: [rec("C:/new.txt", 200)] });
    });
    expect(result.current.items).toHaveLength(100);
    expect(result.current.items[0].path).toBe("C:/new.txt");

    await act(async () => {
      third.resolve(page([rec("C:/z.txt", 300)], 1));
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].path).toBe("C:/z.txt");
  });

  it("有查询时实时事件只置 stale", async () => {
    const d = deferred<QueryPage>();
    vi.mocked(queryFiles).mockReturnValue(d.promise);
    const { result } = renderHook(() => useFiles("x", 50, 0, 0));
    await waitFor(() => expect(eventHandler).toBeDefined());
    await act(async () => {
      d.resolve(page([], 0));
    });
    act(() => {
      eventHandler!({ payload: [rec("C:/new.txt", 1)] });
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.stale).toBe(true);
  });

  it("非首页时实时事件只置 stale", async () => {
    const d = deferred<QueryPage>();
    vi.mocked(queryFiles).mockReturnValue(d.promise);
    const { result } = renderHook((props) => useFiles("", 50, props.offset, 0), {
      initialProps: { offset: 50 },
    });
    await waitFor(() => expect(eventHandler).toBeDefined());
    await act(async () => {
      d.resolve(page([], 0));
    });
    act(() => {
      eventHandler!({ payload: [rec("C:/new.txt", 1)] });
    });
    expect(result.current.stale).toBe(true);
  });
});
