import { describe, expect, it } from "vitest";
import registry from "../../fixtures/error-codes.json";
import { ERROR_CODES, errorSeverity, severityOrFallback } from "./errorCodes";
import { errorCode } from "./errors";

describe("错误码注册表", () => {
  it("fixture 三级分级齐备", () => {
    expect(registry.severities).toEqual(["retryable", "ignorable", "needs_user"]);
  });

  it("镜像与 fixture 真源一致", () => {
    const fixtureCodes = registry.codes.map((entry) => entry.code);
    expect([...ERROR_CODES]).toEqual(fixtureCodes);
    for (const entry of registry.codes) {
      expect(errorSeverity(entry.code)).toBe(entry.severity);
    }
  });

  it("分级查询：已知码返回分级，未注册返回 null / 兜底 needs_user", () => {
    expect(errorSeverity("archive.locked")).toBe("retryable");
    expect(errorSeverity("archive.not_indexed")).toBe("ignorable");
    expect(errorSeverity("archive.forbidden")).toBe("needs_user");
    expect(errorSeverity("no.such_code")).toBeNull();
    expect(severityOrFallback("no.such_code")).toBe("needs_user");
  });

  it("与 errorCode 解析口径衔接", () => {
    const err = "archive_guard.blocked|drive_root";
    expect(errorCode(err)).toBe("archive_guard.blocked");
    expect(errorSeverity(errorCode(err)!)).toBe("needs_user");
  });
});
