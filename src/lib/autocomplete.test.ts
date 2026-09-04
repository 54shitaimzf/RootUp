import { describe, expect, it } from "vitest";
import {
  addTag,
  getSuggestions,
  habitKeyForTag,
  removeLastTag,
  removeTag,
  resolveInsertion,
  tokenRangeAt,
  type FilterTags,
  type Suggestion,
} from "./autocomplete";
import type { FilterHabits } from "./filterHabits";

const keywords: Suggestion[] = [
  { kind: "keyword", key: "keyword:cat:", raw: "cat:", token: "cat:", display: "按类别筛选" },
  { kind: "keyword", key: "keyword:type:", raw: "type:", token: "type:", display: "按扩展名筛选" },
  { kind: "keyword", key: "keyword:label:", raw: "label:", token: "label:", display: "按标签筛选" },
  { kind: "keyword", key: "keyword:state:", raw: "state:", token: "state:", display: "按状态筛选" },
  { kind: "keyword", key: "keyword:size:", raw: "size:", token: "size:", display: "按大小筛选" },
  { kind: "keyword", key: "keyword:before:", raw: "before:", token: "before:", display: "之前" },
  { kind: "keyword", key: "keyword:after:", raw: "after:", token: "after:", display: "之后" },
];

const values: Suggestion[] = [
  { kind: "category", key: "category:document", raw: "document", token: "cat:document", display: "文档" },
  { kind: "category", key: "category:image", raw: "image", token: "cat:image", display: "图片" },
  { kind: "category", key: "category:archive", raw: "archive", token: "cat:archive", display: "压缩包" },
  { kind: "state", key: "state:pending", raw: "pending", token: "state:pending", display: "确认中" },
  { kind: "state", key: "state:indexed", raw: "indexed", token: "state:indexed", display: "已索引" },
  { kind: "label", key: "label:高数", raw: "高数", token: "label:高数", display: "高数" },
  { kind: "label", key: "label:project-x", raw: "project-x", token: "label:project-x", display: "project-x" },
];

const candidates = [...keywords, ...values];

const habits: FilterHabits = {
  "label:高数": { count: 9, lastUsed: 2 },
  "category:document": { count: 5, lastUsed: 1 },
  "state:indexed": { count: 2, lastUsed: 3 },
};

const archive = values[2];
const document = values[0];
const keywordType = keywords[1];

describe("tokenRangeAt", () => {
  it("定位光标所在 token 与边界", () => {
    expect(tokenRangeAt("高数 cat:doc", 3)).toEqual({
      start: 3,
      end: 10,
      token: "cat:doc",
    });
    expect(tokenRangeAt("a", 1)).toEqual({ start: 0, end: 1, token: "a" });
    expect(tokenRangeAt("高数 ", 3)).toEqual({ start: 3, end: 3, token: "" });
  });
});

describe("getSuggestions", () => {
  it("空输入按习惯返回值候选，不含关键词", () => {
    const result = getSuggestions("", candidates, habits, 3);
    expect(result.some((s) => s.kind === "keyword")).toBe(false);
    expect(result.map((s) => s.key)).toEqual([
      "label:高数",
      "category:document",
      "state:indexed",
    ]);
  });

  it("末尾空格时关键词优先", () => {
    const result = getSuggestions("高数 ", candidates, habits, 8);
    expect(result.slice(0, 6).map((s) => s.raw)).toEqual([
      "cat:",
      "type:",
      "label:",
      "state:",
      "size:",
      "before:",
    ]);
  });

  it("关键词前缀匹配", () => {
    expect(getSuggestions("typ", candidates, habits, 8).map((s) => s.raw)).toEqual([
      "type:",
    ]);
    expect(getSuggestions("cat", candidates, habits, 8).map((s) => s.raw)).toEqual([
      "cat:",
    ]);
    expect(getSuggestions("s", candidates, habits, 8).map((s) => s.raw)).toEqual([
      "state:",
      "size:",
    ]);
  });

  it("cat: 前缀进入两段式第二段", () => {
    const result = getSuggestions("cat:", candidates, habits, 8);
    expect(result.every((s) => s.kind === "category")).toBe(true);
  });

  it("cat:doc 补全 document", () => {
    expect(getSuggestions("cat:doc", candidates, habits, 8).map((s) => s.key)).toEqual([
      "category:document",
    ]);
  });

  it("type: 是扩展名语义，不再补全类别值", () => {
    expect(getSuggestions("type:doc", candidates, habits, 8)).toEqual([]);
  });

  it("前缀匹配优先于子串匹配", () => {
    const result = getSuggestions("a", candidates, habits, 8);
    const prefixKeys = result.filter((s) =>
      s.raw.toLowerCase().startsWith("a"),
    );
    expect(prefixKeys.length).toBeGreaterThan(0);
    // 关键词 after: 与值 archive 同时出现（关键词优先）
    expect(result[0].kind).toBe("keyword");
    expect(result.some((s) => s.key === "category:archive")).toBe(true);
  });

  it("大小写不敏感、limit 生效、空候选安全", () => {
    expect(getSuggestions("CAT:Doc", candidates, habits, 8).map((s) => s.key)).toEqual([
      "category:document",
    ]);
    expect(getSuggestions("", candidates, habits, 1)).toHaveLength(1);
    expect(getSuggestions("高", [], habits, 8)).toEqual([]);
  });
});

describe("resolveInsertion", () => {
  it("关键词替换匹配片段", () => {
    expect(resolveInsertion("typ", 3, keywordType)).toEqual({
      text: "type:",
      caret: 5,
      tag: null,
    });
    expect(resolveInsertion("type:doc", 8, keywordType)).toEqual({
      text: "type:",
      caret: 5,
      tag: null,
    });
  });

  it("关键词在无关文本后插入", () => {
    expect(resolveInsertion("高数", 2, keywordType)).toEqual({
      text: "高数 type:",
      caret: 8,
      tag: null,
    });
    expect(resolveInsertion("", 0, keywordType)).toEqual({
      text: "type:",
      caret: 5,
      tag: null,
    });
  });

  it("离散建议消费匹配片段并返回标签", () => {
    expect(resolveInsertion("a", 1, archive)).toEqual({
      text: "",
      caret: 0,
      tag: { kind: "category", value: "archive" },
    });
    expect(resolveInsertion("高数 a", 4, archive)).toEqual({
      text: "高数",
      caret: 2,
      tag: { kind: "category", value: "archive" },
    });
    expect(resolveInsertion("cat:doc", 8, document)).toEqual({
      text: "",
      caret: 0,
      tag: { kind: "category", value: "document" },
    });
  });

  it("离散建议不匹配无关文字时仅返回标签", () => {
    expect(resolveInsertion("笔记", 2, archive)).toEqual({
      text: "笔记",
      caret: 2,
      tag: { kind: "category", value: "archive" },
    });
  });

  it("光标感知：替换光标所在 token 而非末尾", () => {
    expect(resolveInsertion("cat:doc 笔记", 5, document)).toEqual({
      text: "笔记",
      caret: 2,
      tag: { kind: "category", value: "document" },
    });
  });
});

describe("标签操作", () => {
  const empty: FilterTags = { categories: [], states: [], labels: [] };

  it("addTag 去重", () => {
    const once = addTag(empty, { kind: "category", value: "document" });
    expect(once.added).toBe(true);
    expect(once.tags.categories).toEqual(["document"]);
    const twice = addTag(once.tags, { kind: "category", value: "document" });
    expect(twice.added).toBe(false);
  });

  it("removeTag 仅移除对应维度", () => {
    const tags: FilterTags = {
      categories: ["document"],
      states: ["pending"],
      labels: ["高数"],
    };
    expect(removeTag(tags, { kind: "label", value: "高数" })).toEqual({
      categories: ["document"],
      states: ["pending"],
      labels: [],
    });
  });

  it("removeLastTag 按 categories → states → labels 顺序移除最后一个", () => {
    const tags: FilterTags = {
      categories: ["document"],
      states: ["pending"],
      labels: ["高数"],
    };
    const first = removeLastTag(tags);
    expect(first.removed).toEqual({ kind: "label", value: "高数" });
    const second = removeLastTag(first.tags);
    expect(second.removed).toEqual({ kind: "state", value: "pending" });
    const third = removeLastTag(second.tags);
    expect(third.removed).toEqual({ kind: "category", value: "document" });
    expect(removeLastTag(third.tags).removed).toBeNull();
  });

  it("habitKeyForTag 生成与筛选行一致的习惯键", () => {
    expect(habitKeyForTag({ kind: "category", value: "document" })).toBe(
      "category:document",
    );
    expect(habitKeyForTag({ kind: "state", value: "pending" })).toBe(
      "state:pending",
    );
    expect(habitKeyForTag({ kind: "label", value: "高数" })).toBe("label:高数");
  });
});
