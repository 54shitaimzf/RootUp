import { describe, expect, it } from "vitest";
import { applySuggestion, getSuggestions, type Suggestion } from "./autocomplete";
import type { FilterHabits } from "./filterHabits";

const candidates: Suggestion[] = [
  { kind: "category", key: "category:document", raw: "document", token: "type:document", display: "文档" },
  { kind: "category", key: "category:image", raw: "image", token: "type:image", display: "图片" },
  { kind: "state", key: "state:pending", raw: "pending", token: "state:pending", display: "确认中" },
  { kind: "state", key: "state:indexed", raw: "indexed", token: "state:indexed", display: "已索引" },
  { kind: "label", key: "label:高数", raw: "高数", token: "label:高数", display: "高数" },
  { kind: "label", key: "label:project-x", raw: "project-x", token: "label:project-x", display: "project-x" },
];

const habits: FilterHabits = {
  "label:高数": { count: 9, lastUsed: 2 },
  "category:document": { count: 5, lastUsed: 1 },
  "state:indexed": { count: 2, lastUsed: 3 },
};

describe("getSuggestions", () => {
  it("空输入按习惯返回前 N 条", () => {
    const result = getSuggestions("", candidates, habits, 3);
    expect(result.map((s) => s.token)).toEqual([
      "label:高数",
      "type:document",
      "state:indexed",
    ]);
  });

  it("type: 前缀只补全类别", () => {
    const result = getSuggestions("type:", candidates, habits, 8);
    expect(result.every((s) => s.kind === "category")).toBe(true);
  });

  it("type:doc 补全 document", () => {
    const result = getSuggestions("type:doc", candidates, habits, 8);
    expect(result.map((s) => s.key)).toEqual(["category:document"]);
  });

  it("前缀匹配大小写不敏感", () => {
    expect(getSuggestions("TYPE:PDF", candidates, habits, 8)).toEqual([]);
    expect(getSuggestions("Type:Doc", candidates, habits, 8).map((s) => s.key)).toEqual([
      "category:document",
    ]);
  });

  it("label: 前缀按中文子串补全", () => {
    const result = getSuggestions("label:高", candidates, habits, 8);
    expect(result.map((s) => s.key)).toEqual(["label:高数"]);
  });

  it("普通文字按键与展示名匹配", () => {
    expect(getSuggestions("doc", candidates, habits, 8).map((s) => s.key)).toEqual([
      "category:document",
    ]);
    expect(getSuggestions("高", candidates, habits, 8).map((s) => s.key)).toEqual([
      "label:高数",
    ]);
  });

  it("空候选返回空数组，limit 生效", () => {
    expect(getSuggestions("", [], habits, 8)).toEqual([]);
    expect(getSuggestions("", candidates, habits, 1)).toHaveLength(1);
  });
});

describe("applySuggestion", () => {
  it("同维度前缀替换残缺 token", () => {
    expect(applySuggestion("type:doc", candidates[0])).toBe("type:document");
    expect(applySuggestion("高数 label:高", candidates[4])).toBe(
      "高数 label:高数",
    );
  });

  it("无前缀时追加到末尾", () => {
    expect(applySuggestion("高数", candidates[4])).toBe("高数 label:高数");
    expect(applySuggestion("", candidates[0])).toBe("type:document");
  });

  it("不同维度前缀不替换", () => {
    expect(applySuggestion("state:pen", candidates[0])).toBe(
      "state:pen type:document",
    );
  });
});
