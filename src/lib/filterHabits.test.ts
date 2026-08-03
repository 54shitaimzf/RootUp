import { describe, expect, it } from "vitest";
import {
  parseFilterHabits,
  sortFilterItems,
  topSuggestions,
  touchHabit,
  type FilterHabits,
} from "./filterHabits";

interface Item {
  key: string;
  label: string;
}

const items: Item[] = [
  { key: "category:document", label: "文档" },
  { key: "category:image", label: "图片" },
  { key: "label:高数", label: "高数" },
  { key: "state:pending", label: "确认中" },
];

describe("touchHabit", () => {
  it("首次点击计数为 1 并记录时间", () => {
    const next = touchHabit({}, "category:document", 1000);
    expect(next["category:document"]).toEqual({ count: 1, lastUsed: 1000 });
  });

  it("重复点击累加并刷新时间，其它项不受影响", () => {
    const once = touchHabit({}, "category:document", 1000);
    const twice = touchHabit(once, "category:document", 2000);
    expect(twice["category:document"]).toEqual({ count: 2, lastUsed: 2000 });
    expect(twice["category:image"]).toBeUndefined();
  });
});

describe("sortFilterItems", () => {
  it("已选置前，其余按 count 降序", () => {
    const habits: FilterHabits = {
      "category:image": { count: 5, lastUsed: 1 },
      "label:高数": { count: 3, lastUsed: 2 },
    };
    const sorted = sortFilterItems(items, habits, ["state:pending"]);
    expect(sorted.map((i) => i.key)).toEqual([
      "state:pending",
      "category:image",
      "label:高数",
      "category:document",
    ]);
  });

  it("count 相同按 lastUsed 降序", () => {
    const habits: FilterHabits = {
      "category:document": { count: 2, lastUsed: 100 },
      "category:image": { count: 2, lastUsed: 200 },
    };
    const sorted = sortFilterItems(items, habits, []);
    expect(sorted[0].key).toBe("category:image");
    expect(sorted[1].key).toBe("category:document");
  });

  it("全部相等的项保持原始顺序", () => {
    const sorted = sortFilterItems(items, {}, []);
    expect(sorted.map((i) => i.key)).toEqual(items.map((i) => i.key));
  });

  it('key 为 "all" 的项永远最前', () => {
    const withAll: Item[] = [{ key: "all", label: "全部" }, ...items];
    const sorted = sortFilterItems(withAll, {}, ["category:document"]);
    expect(sorted[0].key).toBe("all");
    expect(sorted[1].key).toBe("category:document");
  });
});

describe("topSuggestions", () => {
  it("按频率截断到 limit", () => {
    const habits: FilterHabits = {
      "category:image": { count: 9, lastUsed: 1 },
      "label:高数": { count: 2, lastUsed: 2 },
    };
    expect(topSuggestions(items, habits, 2).map((i) => i.key)).toEqual([
      "category:image",
      "label:高数",
    ]);
  });

  it("空数据返回空数组", () => {
    expect(topSuggestions([], {}, 5)).toEqual([]);
  });
});

describe("parseFilterHabits", () => {
  it("缺失与空串返回空对象", () => {
    expect(parseFilterHabits(null)).toEqual({});
    expect(parseFilterHabits("")).toEqual({});
  });

  it("非法 JSON 抛出异常", () => {
    expect(() => parseFilterHabits("{ 不是 JSON")).toThrow();
  });

  it("非对象结构抛出异常", () => {
    expect(() => parseFilterHabits("[1,2]")).toThrow();
    expect(() => parseFilterHabits('"x"')).toThrow();
  });

  it("过滤非法字段并保留合法项", () => {
    const raw = JSON.stringify({
      ok: { count: 3, lastUsed: 123 },
      bad1: { count: "x", lastUsed: 1 },
      bad2: { count: 1 },
    });
    expect(parseFilterHabits(raw)).toEqual({
      ok: { count: 3, lastUsed: 123 },
    });
  });
});
