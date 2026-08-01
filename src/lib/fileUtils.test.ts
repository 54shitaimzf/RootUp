import { describe, expect, it } from "vitest";
import type { FileRecord } from "./tauri";
import {
  fileStateMeta,
  filterFiles,
  formatFileSize,
  formatTimestamp,
  mergeFiles,
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

describe("formatTimestamp", () => {
  it("非法输入返回占位符", () => {
    expect(formatTimestamp(0)).toBe("—");
  });

  it("输出本地日期时间", () => {
    const out = formatTimestamp(new Date(2026, 0, 2, 3, 4).getTime());
    expect(out).toMatch(/^2026\/01\/02 03:04$/);
  });
});
