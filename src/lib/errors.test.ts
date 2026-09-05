import { describe, expect, it } from "vitest";
import { errorCode, errorMessage } from "./errors";

describe("结构化错误码解析", () => {
  it("提取合法 code 并剥离前缀", () => {
    expect(errorCode("scheme.duplicate|方案名称已存在")).toBe("scheme.duplicate");
    expect(errorMessage("scheme.duplicate|方案名称已存在")).toBe("方案名称已存在");
    expect(errorCode("scheme.limit|自定义方案已达上限（20 个）")).toBe("scheme.limit");
  });

  it("无 code 的错误原样返回", () => {
    expect(errorCode("归档根目录不能与监控目录相同")).toBeNull();
    expect(errorMessage("归档根目录不能与监控目录相同")).toBe(
      "归档根目录不能与监控目录相同",
    );
    expect(errorCode(new Error("boom"))).toBeNull();
    expect(errorMessage(new Error("boom"))).toBe("Error: boom");
  });

  it("非错误码形态的前缀不误判", () => {
    expect(errorCode("schemes: 无法获取数据目录: x")).toBeNull();
    expect(errorCode("C:\\path|file")).toBeNull();
    expect(errorCode("A|B")).toBeNull();
  });
});
