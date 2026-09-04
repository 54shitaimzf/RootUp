import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  archivePreview,
  buildAutocompleteCandidates,
  canIdeOpen,
  presentRow,
  CODE_EDITOR_EXTENSIONS,
  KEYWORD_DISPLAY_KEY,
  PAGE_SIZE,
  FILE_ROW_HEIGHT,
  VIRTUAL_ROW_THRESHOLD,
} from "./model";
import { KEYWORD_PREFIXES, type Suggestion } from "../../lib/autocomplete";
import type { FileRecord } from "../../lib/tauri";

const t = ((key: string, fallback?: string) => fallback ?? key) as unknown as TFunction;

const labelDefs = {
  document: { key: "document", name: "文档", icon: "file", color: "sky" },
  "course-1": { key: "course-1", name: "高等数学", icon: "book", color: "violet" },
};

function file(partial: Partial<FileRecord>): FileRecord {
  return {
    id: 1,
    path: "C:/docs/notes.txt",
    name: "notes.txt",
    size: 64,
    file_type: "txt",
    labels: "document",
    first_seen: 1,
    modified: 1,
    state: "indexed",
    ...partial,
  };
}

describe("files/model 常量", () => {
  it("分页与虚拟滚动常量为预期值", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(FILE_ROW_HEIGHT).toBe(56);
    expect(VIRTUAL_ROW_THRESHOLD).toBe(200);
  });

  it("IDE 扩展名判断大小写不敏感且不含二进制类型", () => {
    expect(canIdeOpen("txt")).toBe(true);
    expect(canIdeOpen("TXT")).toBe(true);
    expect(canIdeOpen("exe")).toBe(false);
    expect(CODE_EDITOR_EXTENSIONS.has("md")).toBe(true);
  });

  it("关键字展示 key 覆盖全部关键字前缀", () => {
    for (const prefix of KEYWORD_PREFIXES) {
      expect(KEYWORD_DISPLAY_KEY[prefix]).toBeTruthy();
    }
  });
});

describe("buildAutocompleteCandidates", () => {
  it("候选顺序为关键字 → 类别 → 状态 → 标签", () => {
    const suggestions = buildAutocompleteCandidates({
      categories: ["document", "image"],
      orderedAvailableLabels: ["course-1", "archive"],
      mergedLabelDefs: labelDefs,
      t,
    });
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds.indexOf("keyword")).toBeLessThan(kinds.indexOf("category"));
    expect(kinds.indexOf("category")).toBeLessThan(kinds.indexOf("state"));
    expect(kinds.indexOf("state")).toBeLessThan(kinds.indexOf("label"));
    expect(suggestions[suggestions.length - 1]).toEqual({
      kind: "label",
      key: "label:archive",
      raw: "archive",
      token: "label:archive",
      display: "archive",
    } satisfies Suggestion);
  });

  it("标签候选显示注册表名称", () => {
    const suggestions = buildAutocompleteCandidates({
      categories: [],
      orderedAvailableLabels: ["course-1"],
      mergedLabelDefs: labelDefs,
      t,
    });
    const last = suggestions[suggestions.length - 1];
    expect(last.display).toBe("高等数学");
  });
});

describe("presentRow", () => {
  it("标签按显示名去重且课程标签优先", () => {
    const row = presentRow(
      file({ labels: "document,course-1,document" }),
      labelDefs,
      { "course-1": labelDefs["course-1"] },
      t,
    );
    expect(row.sortedLabels).toEqual(["course-1", "document"]);
    expect(row.firstName).toBe("高等数学");
    expect(row.firstDef?.color).toBe("violet");
  });

  it("未知标签回退原文并保留在列表中", () => {
    const row = presentRow(file({ labels: "custom-x" }), labelDefs, {}, t);
    expect(row.sortedLabels).toEqual(["custom-x"]);
    expect(row.firstName).toBe("custom-x");
    expect(row.firstDef).toBeUndefined();
  });

  it("大小与 IDE 展示派生正确", () => {
    const row = presentRow(file({ size: 2048, file_type: "PNG" }), labelDefs, {}, t);
    expect(row.sizeParts).toEqual({ value: "2.0", unit: "KB" });
    expect(row.canIdeOpen).toBe(false);
    expect(row.meta.labelKey).toBe("files.stateIndexed");
  });
});

describe("archivePreview", () => {
  it("按首个标签解析类别目录，未知回落 other", () => {
    expect(archivePreview("C:/d/a.pdf", "document,code", "C:/Arc")).toBe(
      "C:/Arc/document/a.pdf",
    );
    expect(archivePreview("C:/d/a.bin", "unknown-cat", "C:/Arc")).toBe(
      "C:/Arc/other/a.bin",
    );
    expect(archivePreview("C:/d/no-ext", "", "C:/Arc")).toBe(
      "C:/Arc/other/no-ext",
    );
  });
});
