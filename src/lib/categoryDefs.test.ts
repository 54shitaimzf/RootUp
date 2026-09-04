import { describe, expect, it } from "vitest";
import appContractsFixture from "../../fixtures/app-contracts.json";
import {
  CATEGORY_VISUALS,
  DEFAULT_CATEGORY,
  resolveCategoryKey,
  resolveCategoryVisual,
} from "./categoryDefs";

describe("类别视觉注册表", () => {
  it("覆盖 fixture categories 全部键且无多余键", () => {
    const fixtureCategories = appContractsFixture.categories as string[];
    expect(Object.keys(CATEGORY_VISUALS).sort()).toEqual([...fixtureCategories].sort());
  });

  it("每个类别的图标与配色成对且非空", () => {
    for (const [key, visual] of Object.entries(CATEGORY_VISUALS)) {
      expect(visual.icon, `${key} 缺少图标`).toBeTruthy();
      expect(visual.boxClass, `${key} 缺少配色`).toMatch(/dark:/);
    }
  });

  it("resolveCategoryKey 未知/空值回退 other", () => {
    expect(resolveCategoryKey("document")).toBe("document");
    expect(resolveCategoryKey("unknown-cat")).toBe(DEFAULT_CATEGORY);
    expect(resolveCategoryKey("")).toBe(DEFAULT_CATEGORY);
    expect(resolveCategoryKey(null)).toBe(DEFAULT_CATEGORY);
    expect(resolveCategoryKey(undefined)).toBe(DEFAULT_CATEGORY);
  });

  it("resolveCategoryVisual 与 resolveCategoryKey 一致", () => {
    expect(resolveCategoryVisual("video").icon).toBe(CATEGORY_VISUALS.video.icon);
    expect(resolveCategoryVisual("nope")).toBe(CATEGORY_VISUALS[DEFAULT_CATEGORY]);
  });
});
