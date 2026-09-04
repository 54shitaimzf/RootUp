import { describe, expect, it } from "vitest";
import type { FileRecord } from "./tauri";
import {
  archiveDestPath,
  buildQuery,
  fileStateMeta,
  filterFiles,
  formatFileSize,
  formatFileSizeParts,
  formatTimestamp,
  joinArchivePath,
  loadMoreMerge,
  mergeFiles,
  parseLabels,
  pathBasename,
  resolveArchiveDir,
  sortLabelsByPriority,
  splitPathError,
} from "./fileUtils";

function rec(
  path: string,
  modified: number,
  state: FileRecord["state"] = "indexed",
): FileRecord {
  const name = path.split("/").pop() ?? path;
  return {
    id: 0,
    path,
    name,
    size: 100,
    file_type: "txt",
    labels: "",
    first_seen: modified,
    modified,
    state,
  };
}

describe("filterFiles", () => {
  const files = [rec("C:/Math/notes.pdf", 1), rec("C:/Music/song.mp3", 2)];

  it("空查询返回全部", () => {
    expect(filterFiles(files, "")).toHaveLength(2);
    expect(filterFiles(files, "   ")).toHaveLength(2);
  });

  it("按名称过滤且忽略大小写", () => {
    expect(filterFiles(files, "NOTES")).toHaveLength(1);
    expect(filterFiles(files, "song")).toHaveLength(1);
  });

  it("按路径过滤", () => {
    expect(filterFiles(files, "math")).toHaveLength(1);
  });

  it("无匹配返回空", () => {
    expect(filterFiles(files, "nothing")).toHaveLength(0);
  });
});

describe("buildQuery", () => {
  it("类别产 cat: token，重复去重（自动补全与 chips 重叠）", () => {
    expect(
      buildQuery({
        text: "label:高数",
        labels: ["高数"],
        categories: ["document", "document"],
      }),
    ).toBe("label:高数 cat:document");
  });

  it("保留首次出现的顺序", () => {
    expect(
      buildQuery({
        text: "笔记",
        categories: ["image", "document"],
        states: ["indexed"],
      }),
    ).toBe("笔记 cat:image cat:document state:indexed");
  });

  it("组合文本、类别、状态与标签", () => {
    expect(
      buildQuery({
        text: "高数",
        categories: ["document"],
        states: ["pending"],
        labels: ["course"],
      }),
    ).toBe("高数 cat:document state:pending label:course");
  });

  it("空筛选器返回空串", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ text: "  " })).toBe("");
  });
});

describe("parseLabels", () => {
  it("拆分逗号分隔标签", () => {
    expect(parseLabels("document,course")).toEqual(["document", "course"]);
  });

  it("空与空白标签被过滤", () => {
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels(" , , ")).toEqual([]);
    expect(parseLabels("document, ,code")).toEqual(["document", "code"]);
  });

  it("标签键去重", () => {
    expect(parseLabels("document,document, code,code")).toEqual([
      "document",
      "code",
    ]);
  });
});

describe("sortLabelsByPriority", () => {
  const isCourse = (key: string) => key.startsWith("course-");

  it("课程标签在前、通用标签在后，组内保持原顺序", () => {
    expect(
      sortLabelsByPriority(
        ["document", "course-b", "audio", "course-a"],
        isCourse,
      ),
    ).toEqual(["course-b", "course-a", "document", "audio"]);
  });

  it("空数组与全课程/全通用均稳定", () => {
    expect(sortLabelsByPriority([], isCourse)).toEqual([]);
    expect(sortLabelsByPriority(["course-a", "course-b"], isCourse)).toEqual([
      "course-a",
      "course-b",
    ]);
    expect(sortLabelsByPriority(["audio", "video"], isCourse)).toEqual([
      "audio",
      "video",
    ]);
  });
});

describe("mergeFiles", () => {
  it("新增与更新按 path 合并", () => {
    const result = mergeFiles(
      [rec("C:/a.txt", 1)],
      [rec("C:/b.txt", 2), rec("C:/a.txt", 3)],
    );
    expect(result).toHaveLength(2);
    expect(result.find((f) => f.path === "C:/a.txt")?.modified).toBe(3);
  });

  it("deleted 记录被移除", () => {
    const result = mergeFiles(
      [rec("C:/a.txt", 1), rec("C:/b.txt", 2)],
      [rec("C:/a.txt", 1, "deleted")],
    );
    expect(result.map((f) => f.path)).toEqual(["C:/b.txt"]);
  });

  it("按 modified 倒序并截断", () => {
    const many = Array.from({ length: 250 }, (_, i) => rec(`C:/f${i}.txt`, i));
    const result = mergeFiles([], many, 200);
    expect(result).toHaveLength(200);
    expect(result[0].modified).toBe(249);
    expect(result[199].modified).toBe(50);
  });

  it("cap 大于 limit 时保留已加载的更多页（调用方按 prev.length 传 cap）", () => {
    const loaded = Array.from({ length: 100 }, (_, i) =>
      rec(`C:/f${i}.txt`, i),
    );
    const result = mergeFiles(loaded, [rec("C:/new.txt", 200)], 100);
    expect(result).toHaveLength(100);
    expect(result[0].path).toBe("C:/new.txt");
    expect(result.some((f) => f.path === "C:/f0.txt")).toBe(false);
  });
});

describe("loadMoreMerge", () => {
  it("下一页追加到已有列表并去重", () => {
    const result = loadMoreMerge(
      [rec("C:/a.txt", 2)],
      [rec("C:/b.txt", 3), rec("C:/a.txt", 4)],
      100,
    );
    expect(result).toHaveLength(2);
    expect(result.find((f) => f.path === "C:/a.txt")?.modified).toBe(4);
  });

  it("按 modified 倒序排列", () => {
    const result = loadMoreMerge(
      [rec("C:/old.txt", 1)],
      [rec("C:/new.txt", 5)],
      100,
    );
    expect(result.map((f) => f.path)).toEqual(["C:/new.txt", "C:/old.txt"]);
  });

  it("cap 等于 offset+limit 时截断到已加载总量", () => {
    const first = Array.from({ length: 50 }, (_, i) => rec(`C:/f${i}.txt`, i));
    const second = Array.from(
      { length: 50 },
      (_, i) => rec(`C:/g${i}.txt`, 100 + i),
    );
    const result = loadMoreMerge(first, second, 100);
    expect(result).toHaveLength(100);
    expect(result[0].modified).toBe(149);
  });

  it("deleted 记录从累计列表移除", () => {
    const result = loadMoreMerge(
      [rec("C:/a.txt", 1)],
      [rec("C:/a.txt", 1, "deleted")],
      100,
    );
    expect(result).toEqual([]);
  });
});

describe("fileStateMeta", () => {
  it("每个状态都有文案与颜色", () => {
    for (const state of ["pending", "indexed", "archived", "deleted"] as const) {
      const meta = fileStateMeta(state);
      expect(meta.labelKey).toContain("files.state");
      expect(meta.dotClass).toMatch(/^bg-/);
    }
  });
});

describe("formatFileSize", () => {
  it("格式化各量级", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });

  it("非法输入返回占位符", () => {
    expect(formatFileSize(-1)).toBe("—");
    expect(formatFileSize(Number.NaN)).toBe("—");
  });
});

describe("formatFileSizeParts", () => {
  it("数字与单位拆分且与 formatFileSize 一致", () => {
    expect(formatFileSizeParts(0)).toEqual({ value: "0", unit: "B" });
    expect(formatFileSizeParts(1536)).toEqual({ value: "1.5", unit: "KB" });
    expect(formatFileSizeParts(-1)).toEqual({ value: "—", unit: "" });
    expect(formatFileSizeParts(1048576)).toEqual({
      value: "1.0",
      unit: "MB",
    });
  });
});

describe("formatTimestamp", () => {
  it("非法输入返回占位符", () => {
    expect(formatTimestamp(0)).toBe("—");
  });

  it("输出本地日期时间", () => {
    const out = formatTimestamp(new Date(2026, 0, 2, 3, 4).getTime());
    expect(out).toMatch(/^2026\/01\/02 03:04$/);
  });
});

describe("归档目的地路径派生", () => {
  it("resolveArchiveDir 按首个标签解析类别目录，未知回落 other", () => {
    expect(resolveArchiveDir("document,code")).toBe("document");
    expect(resolveArchiveDir("unknown-cat")).toBe("other");
    expect(resolveArchiveDir("")).toBe("other");
  });

  it("joinArchivePath 剥除根尾部分隔符并以 / 连接", () => {
    expect(joinArchivePath("C:/Arc", "document", "a.pdf")).toBe(
      "C:/Arc/document/a.pdf",
    );
    expect(joinArchivePath("D:\\Arc\\", "document", "a.pdf")).toBe(
      "D:/Arc/document/a.pdf",
    );
    expect(joinArchivePath("C:/Arc", "", "a.pdf")).toBe("C:/Arc/a.pdf");
    expect(joinArchivePath("", "document", "a.pdf")).toBe("document/a.pdf");
  });

  it("archiveDestPath 产出单文件完整目标路径", () => {
    expect(archiveDestPath("C:/Arc", "document,code", "a.pdf")).toBe(
      "C:/Arc/document/a.pdf",
    );
    expect(archiveDestPath("C:/Arc/", "no-ext", "b.bin")).toBe(
      "C:/Arc/other/b.bin",
    );
  });
});

describe("splitPathError", () => {
  it("拆分「路径: 原因」形态（move_error）", () => {
    expect(
      splitPathError("D:/x/a.pdf: 跨磁盘归档暂不支持，请把归档根放在同一磁盘"),
    ).toEqual({
      path: "D:/x/a.pdf",
      reason: "跨磁盘归档暂不支持，请把归档根放在同一磁盘",
    });
    expect(splitPathError("C:\\y\\b.docx: 文件可能被占用，请关闭相关程序后重试")).toEqual({
      path: "C:\\y\\b.docx",
      reason: "文件可能被占用，请关闭相关程序后重试",
    });
  });

  it("原因在前或无路径时不误拆", () => {
    expect(splitPathError("文件不在索引中: D:/x/a.pdf")).toEqual({
      path: null,
      reason: "文件不在索引中: D:/x/a.pdf",
    });
    expect(splitPathError("请先在设置中配置归档根目录")).toEqual({
      path: null,
      reason: "请先在设置中配置归档根目录",
    });
  });
});

describe("pathBasename", () => {
  it("取末段并兼容两种分隔符", () => {
    expect(pathBasename("D:/Arc/document/a.pdf")).toBe("a.pdf");
    expect(pathBasename("D:\\Arc\\document\\b.docx")).toBe("b.docx");
    expect(pathBasename("name-only.txt")).toBe("name-only.txt");
  });
});
