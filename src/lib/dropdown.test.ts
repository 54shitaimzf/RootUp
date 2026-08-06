import { describe, expect, it } from "vitest";
import { dropdownPosition } from "./dropdown";

describe("dropdownPosition", () => {
  const viewport = { width: 1024, height: 768 };
  const anchor = { top: 100, bottom: 120, left: 50, width: 176 };

  it("下方空间足够时置于触发下方并保持最小宽度", () => {
    const position = dropdownPosition(anchor, viewport, 240);
    expect(position.top).toBe(124);
    expect(position.left).toBe(50);
    expect(position.width).toBe(240);
    expect(position.maxHeight).toBeLessThanOrEqual(Math.round(768 * 0.6));
  });

  it("右侧越界时钳制在视口内", () => {
    const position = dropdownPosition(
      { ...anchor, left: 900 },
      viewport,
      240,
    );
    expect(position.left).toBe(1024 - 240 - 8);
  });

  it("底部空间不足时向上翻转", () => {
    const position = dropdownPosition(
      { top: 700, bottom: 740, left: 50, width: 176 },
      viewport,
      240,
    );
    expect(position.top).toBeLessThan(700);
    expect(position.top).toBeGreaterThanOrEqual(8);
  });

  it("小视口宽度下压缩弹层宽度", () => {
    const position = dropdownPosition(anchor, { width: 100, height: 768 }, 240);
    expect(position.width).toBe(100 - 8 * 2);
    expect(position.left).toBe(8);
  });

  it("触发宽度小于最小宽度时使用最小宽度", () => {
    const position = dropdownPosition(
      { ...anchor, width: 100 },
      viewport,
      240,
    );
    expect(position.width).toBe(240);
  });

  it("左侧越界时钳制到边距", () => {
    const position = dropdownPosition(
      { ...anchor, left: -30 },
      viewport,
      240,
    );
    expect(position.left).toBe(8);
  });

  it("极小视口高度下高度上限（60% 视口）优先于下限", () => {
    const position = dropdownPosition(
      anchor,
      { width: 1024, height: 40 },
      240,
    );
    expect(position.maxHeight).toBe(Math.round(40 * 0.6));
    expect(position.top).toBeGreaterThanOrEqual(8);
  });

  it("极窄视口压缩宽度且不越界", () => {
    const position = dropdownPosition(anchor, { width: 20, height: 768 }, 240);
    expect(position.width).toBe(4);
    expect(position.left + position.width).toBeLessThanOrEqual(20);
  });
});
