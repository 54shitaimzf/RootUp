import { describe, expect, it } from "vitest";
import { computeVirtualRange } from "./virtual";

describe("computeVirtualRange", () => {
  it("空列表返回空区间", () => {
    expect(
      computeVirtualRange({
        scrollTop: 0,
        listTop: 0,
        viewport: 600,
        rowHeight: 56,
        total: 0,
      }),
    ).toEqual({ start: 0, end: 0 });
  });

  it("列表顶部在视口内时从头渲染可见+缓冲区行", () => {
    const range = computeVirtualRange({
      scrollTop: 100,
      listTop: 100,
      viewport: 600,
      rowHeight: 50,
      total: 500,
      overscan: 5,
    });
    expect(range.start).toBe(0);
    // 可见 12 行 + 上下缓冲
    expect(range.end).toBeLessThanOrEqual(17);
    expect(range.end).toBeGreaterThan(10);
  });

  it("滚动后区间随 scrollTop 平移", () => {
    const range = computeVirtualRange({
      scrollTop: 5100,
      listTop: 100,
      viewport: 600,
      rowHeight: 50,
      total: 500,
      overscan: 5,
    });
    expect(range.start).toBe(95);
    expect(range.end).toBe(117);
  });

  it("越界滚动时钳制到有效区间", () => {
    const range = computeVirtualRange({
      scrollTop: 999999,
      listTop: 100,
      viewport: 600,
      rowHeight: 50,
      total: 30,
      overscan: 5,
    });
    expect(range.start).toBeGreaterThanOrEqual(0);
    expect(range.end).toBe(30);
  });

  it("列表尚未滚入视口时从头渲染", () => {
    const range = computeVirtualRange({
      scrollTop: 0,
      listTop: 2000,
      viewport: 600,
      rowHeight: 50,
      total: 100,
      overscan: 5,
    });
    expect(range.start).toBe(0);
  });
});
