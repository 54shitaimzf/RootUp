import { describe, expect, it } from "vitest";
import registry from "../../fixtures/icon-keys.json";
import { ICON_KEY_REGISTRY, UNIT_VISUALS, resolveIconKey, softwareKindKey } from "./iconKeys";
import { LABEL_ICONS } from "./labelDefs";
import { Folder, Package } from "../theme/icons";

describe("图标 key 注册表", () => {
  it("注册表三段与 fixture 真源一致", () => {
    expect([...ICON_KEY_REGISTRY.labels]).toEqual(registry.labels);
    expect([...ICON_KEY_REGISTRY.units]).toEqual(registry.units);
    expect([...ICON_KEY_REGISTRY.softwareKinds]).toEqual(registry.softwareKinds);
  });

  it("门禁：LABEL_ICONS 键空间与注册表 labels 一致（禁止平行硬编码）", () => {
    expect(Object.keys(LABEL_ICONS).sort()).toEqual([...ICON_KEY_REGISTRY.labels].sort());
  });

  it("门禁：UNIT_VISUALS 键 ⊆ units 键空间且视觉齐备", () => {
    for (const key of Object.keys(UNIT_VISUALS)) {
      expect(ICON_KEY_REGISTRY.units).toContain(key);
      const visual = UNIT_VISUALS[key as keyof typeof UNIT_VISUALS];
      expect(visual?.icon).toBeTruthy();
      expect(visual?.boxClass).toBeTruthy();
    }
    // file 沿用类别图标（不注册单元视觉），project/software 注册
    expect(UNIT_VISUALS.file).toBeUndefined();
    expect(UNIT_VISUALS.project?.icon).toBe(Folder);
    expect(UNIT_VISUALS.software?.icon).toBe(Package);
  });

  it("resolveIconKey：未知 key 回退 fallback", () => {
    expect(resolveIconKey("project", ICON_KEY_REGISTRY.units, "file")).toBe("project");
    expect(resolveIconKey("nope", ICON_KEY_REGISTRY.units, "file")).toBe("file");
    expect(resolveIconKey(null, ICON_KEY_REGISTRY.units, "file")).toBe("file");
  });

  it("softwareKindKey：识别依据未知回退 heuristic", () => {
    expect(softwareKindKey("paf")).toBe("paf");
    expect(softwareKindKey("manual")).toBe("manual");
    expect(softwareKindKey("future-kind")).toBe("heuristic");
    expect(softwareKindKey(undefined)).toBe("heuristic");
  });
});
