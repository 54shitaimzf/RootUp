import { describe, expect, it } from "vitest";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? flattenKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("i18n resources", () => {
  it("zh-CN 与 en 的 key 集合完全一致", () => {
    const zh = flattenKeys(zhCN).sort();
    const enKeys = flattenKeys(en).sort();
    expect(zh).toEqual(enKeys);
  });

  it("包含文件页与监控目录文案", () => {
    expect(zhCN.files.searchPlaceholder).toBeTruthy();
    expect(en.settings.watchedDirsDesc).toBeTruthy();
  });
});
