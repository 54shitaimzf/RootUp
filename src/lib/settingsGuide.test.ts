import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import {
  SETTINGS_GUIDE,
  SETTINGS_GUIDE_GROUPS,
} from "./settingsGuide";

describe("settingsGuide", () => {
  it("id 唯一、分组合法、每个分组都有条目", () => {
    const ids = new Set<string>();
    const groupIds = new Set(SETTINGS_GUIDE_GROUPS.map((group) => group.id));
    for (const entry of SETTINGS_GUIDE) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(groupIds.has(entry.group)).toBe(true);
    }
    for (const group of SETTINGS_GUIDE_GROUPS) {
      expect(SETTINGS_GUIDE.some((entry) => entry.group === group.id)).toBe(
        true,
      );
    }
  });

  it("全部说明 i18n key 可解析（中英一致由 i18n 一致性测试覆盖）", () => {
    for (const entry of SETTINGS_GUIDE) {
      for (const key of [
        entry.titleKey,
        entry.introKey,
        entry.exampleKey,
        entry.tipsKey,
      ]) {
        expect(i18n.t(key), `未解析 key: ${key}`).not.toBe(key);
      }
    }
    for (const group of SETTINGS_GUIDE_GROUPS) {
      expect(i18n.t(group.titleKey)).not.toBe(group.titleKey);
      expect(i18n.t(group.descriptionKey)).not.toBe(group.descriptionKey);
    }
  });
});
