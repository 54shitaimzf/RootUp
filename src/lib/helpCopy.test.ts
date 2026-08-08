import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import zhCN from "../i18n/locales/zh-CN";

const HELP_NAMESPACES = [
  "help",
  "helpTasks",
  "helpTroubleshoot",
  "helpWhatsNew",
  "helpSearch",
  "helpFeedback",
];

function flattenStrings(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
    if (typeof value === "object" && value !== null) {
      return flattenStrings(value as Record<string, unknown>, path);
    }
    return [];
  });
}

const zhHelpStrings = HELP_NAMESPACES.flatMap((ns) =>
  flattenStrings((zhCN as Record<string, unknown>)[ns] as Record<string, unknown>),
);
const enHelpStrings = HELP_NAMESPACES.flatMap((ns) =>
  flattenStrings((en as Record<string, unknown>)[ns] as Record<string, unknown>),
);

describe("帮助文案质量门禁", () => {
  it("中文不出现空泛或 AI 腔表达", () => {
    const banned = [
      "值得注意的是",
      "轻松搞定",
      "无缝",
      "赋能",
      "解锁",
      "稳稳",
      "妥妥",
      "毋庸置疑",
      "总而言之",
      "不言而喻",
      "让我们",
      "告别手动",
    ];
    for (const phrase of banned) {
      expect(
        zhHelpStrings.some((text) => text.includes(phrase)),
        `中文帮助文案出现禁用表达: ${phrase}`,
      ).toBe(false);
    }
  });

  it("English 不出现空泛或 AI 腔表达", () => {
    const banned = [
      "effortlessly",
      "seamlessly",
      "supercharge",
      "unlock",
      "dive into",
      "let's",
      "game-changer",
      "at your fingertips",
    ];
    for (const phrase of banned) {
      expect(
        enHelpStrings.some((text) => text.toLowerCase().includes(phrase)),
        `English help copy contains banned phrase: ${phrase}`,
      ).toBe(false);
    }
  });

  it("帮助文案不出现内部实现标识符", () => {
    const identifiers = [
      "watched_dirs",
      "FileEnumerator",
      "PRAGMA",
      "keyset",
      "scan_diff",
      "action_log",
      "schema",
      "SQLite",
      "rootup.study",
      "tauri",
    ];
    const all = [...zhHelpStrings, ...enHelpStrings];
    for (const identifier of identifiers) {
      expect(
        all.some((text) => text.toLowerCase().includes(identifier.toLowerCase())),
        `帮助文案出现内部标识符: ${identifier}`,
      ).toBe(false);
    }
  });

  it("帮助文案非空", () => {
    for (const text of [...zhHelpStrings, ...enHelpStrings]) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});
