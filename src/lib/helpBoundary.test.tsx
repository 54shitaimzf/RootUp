import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import zhCN from "../i18n/locales/zh-CN";
import { HelpArticleCard } from "../components/HelpArticleCard";
import { HELP_ARTICLES, HELP_ARTICLE_IDS } from "./helpContent";

import helpContentSource from "./helpContent.ts?raw";
import helpSearchSource from "./helpSearch.ts?raw";
import helpFeedbackSource from "./helpFeedback.ts?raw";
import pageHeaderSource from "../components/PageHeader.tsx?raw";
import filePageSource from "../pages/FilePage.tsx?raw";
import projectsPageSource from "../pages/ProjectsPage.tsx?raw";
import studyPageSource from "../pages/StudyPage.tsx?raw";
import settingsPageSource from "../pages/SettingsPage.tsx?raw";
import courseScheduleViewSource from "../features/study/components/CourseScheduleView.tsx?raw";
import homeworkViewSource from "../features/study/components/HomeworkView.tsx?raw";

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, obj);
}

describe("帮助体系边界门禁", () => {
  it("帮助数据层不依赖 React 与组件层", () => {
    const sources = [
      ["helpContent.ts", helpContentSource],
      ["helpSearch.ts", helpSearchSource],
      ["helpFeedback.ts", helpFeedbackSource],
    ] as const;
    for (const [name, source] of sources) {
      expect(source, `${name} 不得 import React`).not.toMatch(
        /from\s+["']react["']/,
      );
      expect(
        source,
        `${name} 不得引用组件/hooks/pages/features`,
      ).not.toMatch(/from\s+["']\.\.\/(components|hooks|pages|features)/);
    }
  });

  it("PageHeader 保持通用，不包含帮助知识", () => {
    expect(pageHeaderSource).not.toMatch(
      /HelpCenter|helpContent|PageHelpButton|HelpArticle/,
    );
  });

  it("页面只引用注册表中的稳定文章 id，不内嵌帮助文案", () => {
    const pageSources = [
      ["src/pages/FilePage.tsx", filePageSource],
      ["src/pages/ProjectsPage.tsx", projectsPageSource],
      ["src/pages/StudyPage.tsx", studyPageSource],
      ["src/pages/SettingsPage.tsx", settingsPageSource],
      [
        "src/features/study/components/CourseScheduleView.tsx",
        courseScheduleViewSource,
      ],
      ["src/features/study/components/HomeworkView.tsx", homeworkViewSource],
    ] as const;
    for (const [rel, source] of pageSources) {
      const ids = [
        ...source.matchAll(/["']((?:tasks|troubleshoot)\.[a-zA-Z0-9.]+)["']/g),
      ].map((match) => match[1]);
      for (const id of ids) {
        expect(
          HELP_ARTICLE_IDS.has(id),
          `${rel} 引用了不存在的文章 id: ${id}`,
        ).toBe(true);
      }
    }
  });

  it("遍历注册表可渲染全部文章（新增文章自动获得 UI 覆盖）", () => {
    render(
      <>
        {HELP_ARTICLES.map((article) => (
          <HelpArticleCard
            key={article.id}
            article={article}
            expanded
            vote={undefined}
            onToggle={() => {}}
            onOpen={() => {}}
            onAction={() => {}}
            onVote={() => {}}
          />
        ))}
      </>,
    );
    for (const article of HELP_ARTICLES) {
      const title = String(
        getByPath(zhCN as unknown as Record<string, unknown>, article.titleKey),
      );
      expect(
        screen.getAllByText(title).length,
        `${article.id} 未能渲染`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
