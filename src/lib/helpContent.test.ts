import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import zhCN from "../i18n/locales/zh-CN";
import { APP_VERSION } from "./constants";
import {
  currentWhatsNew,
  HELP_ARTICLE_IDS,
  HELP_ARTICLES,
  HELP_SEARCH_SOURCES,
  HELP_TABS,
  WHATS_NEW,
} from "./helpContent";
import { searchHelp } from "./helpSearch";
import type { PageKey } from "./nav";

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, obj);
}

const LOCALES = { zh: zhCN, en } as const;

function expectKeyInAllLocales(key: string, label: string) {
  for (const [name, locale] of Object.entries(LOCALES)) {
    expect(
      getByPath(locale as unknown as Record<string, unknown>, key),
      `${label} 缺少 ${name} 的 i18n key: ${key}`,
    ).toBeTruthy();
  }
}

function expectStepsInAllLocales(stepsKey: string, id: string) {
  for (const [name, locale] of Object.entries(LOCALES)) {
    const steps = getByPath(locale as unknown as Record<string, unknown>, stepsKey);
    expect(Array.isArray(steps), `${id} 在 ${name} 中 steps 应为数组`).toBe(true);
    expect((steps as string[]).length).toBeGreaterThanOrEqual(2);
  }
}

const VALID_PAGES = new Set<PageKey>([
  "files",
  "projects",
  "study",
  "tools",
  "settings",
]);

describe("helpContent 注册表", () => {
  it("文章 id 唯一且命名规范", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(HELP_ARTICLE_IDS.size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^(tasks|troubleshoot)\.[a-zA-Z0-9.]+$/);
    }
  });

  it("每篇文章的标题/摘要/步骤键双语存在且步骤为数组", () => {
    for (const article of HELP_ARTICLES) {
      expect(["tasks", "troubleshoot"]).toContain(article.tab);
      expectKeyInAllLocales(article.titleKey, article.id);
      expectKeyInAllLocales(article.summaryKey, article.id);
      expectStepsInAllLocales(article.stepsKey, article.id);
    }
  });

  it("关键词非空，related 与 action 引用有效", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.keywords.length, `${article.id} keywords 为空`).toBeGreaterThan(0);
      for (const relatedId of article.related ?? []) {
        expect(HELP_ARTICLE_IDS.has(relatedId), `${article.id} 的 related 不存在: ${relatedId}`).toBe(true);
      }
      if (article.action) {
        expect(VALID_PAGES.has(article.action.page)).toBe(true);
        expectKeyInAllLocales(article.action.labelKey, `${article.id} action`);
      }
    }
  });

  it("Tab 定义完整且文案键存在", () => {
    const ids = HELP_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["guide", "tasks", "syntax", "settings", "troubleshoot"]);
    for (const tab of HELP_TABS) {
      expectKeyInAllLocales(tab.labelKey, `tab ${tab.id}`);
    }
  });

  it("WHATS_NEW 包含当前版本且条目键双语存在", () => {
    const entry = WHATS_NEW.find((item) => item.version === APP_VERSION);
    expect(entry, `WHATS_NEW 缺少 ${APP_VERSION} 条目`).toBeDefined();
    expect(entry!.keywords.length).toBeGreaterThan(0);
    for (const itemKey of entry!.items) {
      expectKeyInAllLocales(itemKey, `whatsnew ${itemKey}`);
    }
    expect(currentWhatsNew()?.version).toBe(APP_VERSION);
  });

  it("搜索源 id 唯一且每篇文章可被关键词命中", () => {
    const ids = HELP_SEARCH_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of HELP_SEARCH_SOURCES) {
      expectKeyInAllLocales(source.titleKey, `search ${source.id}`);
    }
    const resolve = (key: string) =>
      String(
        getByPath(zhCN as unknown as Record<string, unknown>, key) ?? "",
      );
    for (const article of HELP_ARTICLES) {
      const hit = searchHelp(article.keywords[0], resolve, HELP_SEARCH_SOURCES);
      expect(
        hit.some((result) => result.id === article.id),
        `${article.id} 无法通过关键词 ${article.keywords[0]} 命中`,
      ).toBe(true);
    }
  });
});
