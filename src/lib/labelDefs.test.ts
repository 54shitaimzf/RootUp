import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  DEFAULT_LABEL_ICON,
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  LABEL_ICONS,
  labelColorKey,
  labelIconKey,
} from "./labelDefs";

describe("labelDefs", () => {
  it("色板 12 色、图标注册表非空且含默认项", () => {
    expect(LABEL_COLOR_KEYS.length).toBe(12);
    expect(LABEL_COLOR_KEYS).toContain(DEFAULT_LABEL_COLOR);
    expect(LABEL_COLORS[DEFAULT_LABEL_COLOR].dot).toBeTruthy();
    expect(Object.keys(LABEL_ICONS).length).toBeGreaterThanOrEqual(16);
    expect(LABEL_ICONS[DEFAULT_LABEL_ICON]).toBeDefined();
  });

  it("未知 icon / color 回退默认，合法值原样返回", () => {
    expect(labelIconKey()).toBe(DEFAULT_LABEL_ICON);
    expect(labelIconKey("nope")).toBe(DEFAULT_LABEL_ICON);
    expect(labelIconKey("book")).toBe("book");
    expect(labelColorKey()).toBe(DEFAULT_LABEL_COLOR);
    expect(labelColorKey("nope")).toBe(DEFAULT_LABEL_COLOR);
    expect(labelColorKey("sky")).toBe("sky");
  });
});
