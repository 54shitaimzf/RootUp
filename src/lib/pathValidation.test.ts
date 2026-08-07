import { describe, expect, it } from "vitest";
import { validateDirInput } from "./pathValidation";

describe("validateDirInput", () => {
  it("接受并规范化合法目录", () => {
    const r = validateDirInput("C:/Users/Admin\\Downloads/");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("C:/Users/Admin/Downloads");
  });

  it("拒绝空/非法字符/保留名/盘根", () => {
    expect(validateDirInput("").ok).toBe(false);
    expect(validateDirInput("C:/bad|pipe").ok).toBe(false);
    expect(validateDirInput("C:/CON").ok).toBe(false);
    expect(validateDirInput("C:/COM1/x").ok).toBe(false);
    expect(validateDirInput("C:/trailing./x").ok).toBe(false);
    expect(validateDirInput("C:/").ok).toBe(false);
    expect(validateDirInput("/").ok).toBe(false);
  });
});
