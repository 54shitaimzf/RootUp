import { describe, expect, it } from "vitest";
import { cleanPathInput } from "./paths";

describe("cleanPathInput", () => {
  it("去除首尾空白", () => {
    expect(cleanPathInput("  C:/Downloads  ")).toBe("C:/Downloads");
  });

  it("去掉成对包裹的双引号/单引号", () => {
    expect(cleanPathInput('"C:/My Folder"')).toBe("C:/My Folder");
    expect(cleanPathInput("'D:/Docs'")).toBe("D:/Docs");
    expect(cleanPathInput('" C:/x "')).toBe("C:/x");
  });

  it("不破坏内部引号与普通文本", () => {
    expect(cleanPathInput('C:/"a b"')).toBe('C:/"a b"');
    expect(cleanPathInput("plain")).toBe("plain");
    expect(cleanPathInput("")).toBe("");
  });
});
