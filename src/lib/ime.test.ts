import { describe, expect, it } from "vitest";
import { isComposing } from "./ime";

describe("isComposing", () => {
  it("React 合成事件通过 nativeEvent 判断", () => {
    expect(isComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isComposing({ nativeEvent: { isComposing: false } })).toBe(false);
    expect(isComposing({ nativeEvent: {} })).toBe(false);
  });

  it("原生 KeyboardEvent 直接判断", () => {
    expect(isComposing({ isComposing: true })).toBe(true);
    expect(isComposing({ isComposing: false })).toBe(false);
    expect(isComposing({})).toBe(false);
  });
});
