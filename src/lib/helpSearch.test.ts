import { describe, expect, it } from "vitest";
import type { HelpSearchSource } from "./helpContent";
import { normalizeHelpQuery, searchHelp } from "./helpSearch";

const SOURCES: HelpSearchSource[] = [
  {
    id: "tasks.a",
    tab: "tasks",
    titleKey: "t.a",
    summaryKey: "s.a",
    keywords: ["归档", "archive"],
  },
  {
    id: "tasks.b",
    tab: "tasks",
    titleKey: "t.b",
    summaryKey: "s.b",
    keywords: ["搜索", "search"],
  },
  {
    id: "tasks.c",
    tab: "tasks",
    titleKey: "t.c",
    summaryKey: "s.c",
    keywords: [],
  },
  {
    id: "settings.d",
    tab: "settings",
    titleKey: "t.d",
    summaryKey: "s.d",
    keywords: ["搜索", "search"],
  },
  {
    id: "tasks.x",
    tab: "tasks",
    titleKey: "t.x",
    summaryKey: "s.x",
    keywords: [],
  },
  {
    id: "tasks.y",
    tab: "tasks",
    titleKey: "t.y",
    summaryKey: "s.y",
    keywords: [],
  },
];

const TEXT: Record<string, string> = {
  "t.a": "第一次使用",
  "s.a": "添加文件夹，等待扫描",
  "t.b": "搜索与整理文件",
  "s.b": "用搜索框快速找到文件",
  "t.c": "监控目录",
  "s.c": "添加下载目录或资料目录",
  "t.d": "设置说明",
  "s.d": "告诉 RootUp 看哪些目录",
  "t.x": "其他",
  "s.x": "目录说明",
  "t.y": "另一篇",
  "s.y": "目录介绍",
};

const resolve = (key: string) => TEXT[key] ?? "";

describe("helpSearch", () => {
  it("空查询与纯空白返回空结果", () => {
    expect(searchHelp("", resolve, SOURCES)).toEqual([]);
    expect(searchHelp("   ", resolve, SOURCES)).toEqual([]);
  });

  it("标题命中优先于关键词命中", () => {
    const results = searchHelp("搜索", resolve, SOURCES);
    expect(results[0].id).toBe("tasks.b");
    expect(results[0].score).toBe(0);
    expect(results.map((r) => r.id)).toEqual(["tasks.b", "settings.d"]);
    expect(results[1].score).toBe(1);
  });

  it("关键词命中优先于摘要命中", () => {
    const results = searchHelp("归档", resolve, SOURCES);
    expect(results[0].id).toBe("tasks.a");
    expect(results[0].score).toBe(1);
  });

  it("无匹配返回空数组", () => {
    expect(searchHelp("不存在的词", resolve, SOURCES)).toEqual([]);
  });

  it("英文大小写不敏感且可命中关键词", () => {
    expect(searchHelp("ARCHIVE", resolve, SOURCES).map((r) => r.id)).toEqual([
      "tasks.a",
    ]);
  });

  it("摘要命中排在最后，同分按 id 稳定排序", () => {
    const results = searchHelp("目录", resolve, SOURCES);
    expect(results.map((r) => r.id)).toEqual([
      "tasks.c",
      "settings.d",
      "tasks.x",
      "tasks.y",
    ]);
    expect(results[0].score).toBe(0);
    expect(results.slice(1).every((r) => r.score === 2)).toBe(true);
  });

  it("normalizeHelpQuery 去除首尾空白并转小写", () => {
    expect(normalizeHelpQuery("  Search ")).toBe("search");
  });
});
