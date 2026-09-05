import { describe, expect, it } from "vitest";
import appContracts from "../../fixtures/app-contracts.json";
import { KEY_PATTERN } from "../features/settings/components/LabelManageDialog";
import { PREFERRED_IDE_OPTIONS } from "./projects";
import type { ProjectKind } from "./tauri";

/** 与 fixtures/app-contracts.json 双端锁定的跨语言常量（Rust 侧同源断言）。 */

const PROJECT_KINDS = [
  "rust",
  "node",
  "python",
  "java",
  "csharp",
  "go",
  "unity",
  "cpp",
  "php",
  "ruby",
  "dart",
  "flutter",
  "kotlin",
  "swift",
  "android",
  "generic",
] as const satisfies readonly ProjectKind[];

describe("app-contracts 契约常量", () => {
  it("首选 IDE 白名单与后端一致", () => {
    expect(PREFERRED_IDE_OPTIONS.map((option) => option.value)).toEqual(
      appContracts.preferredIde,
    );
  });

  it("项目类型清单与后端枚举一致", () => {
    expect([...PROJECT_KINDS]).toEqual(appContracts.projectKinds);
  });

  it("标签 key 规则与后端 valid_key 一致", () => {
    const { maxLength, accepts, rejects } = appContracts.labelKey;
    // 前端调用处组合「字符集 + 长度」判断（LabelManageDialog），组合语义对齐后端 valid_key
    const valid = (key: string) => KEY_PATTERN.test(key) && key.length <= maxLength;
    for (const key of accepts) {
      expect(valid(key)).toBe(true);
    }
    for (const key of rejects) {
      expect(valid(key)).toBe(false);
    }
    expect(valid("a".repeat(maxLength))).toBe(true);
    expect(valid("a".repeat(maxLength + 1))).toBe(false);
  });
});
