import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLabelDefs } from "./useLabelDefs";

vi.mock("../lib/tauri", () => ({
  listLabelDefs: vi.fn(),
}));

import { listLabelDefs } from "../lib/tauri";

describe("useLabelDefs", () => {
  it("加载成功转为 key 映射", async () => {
    vi.mocked(listLabelDefs).mockResolvedValue([
      { key: "course", name: "课程资料", icon: "book", color: "sky" },
    ]);
    const { result } = renderHook(() => useLabelDefs());
    await waitFor(() => {
      expect(result.current.course).toEqual({
        key: "course",
        name: "课程资料",
        icon: "book",
        color: "sky",
      });
    });
  });

  it("加载失败回退空表", async () => {
    vi.mocked(listLabelDefs).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useLabelDefs());
    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });
});
