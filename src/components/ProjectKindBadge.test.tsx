import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectKindBadge } from "./ProjectKindBadge";

describe("ProjectKindBadge", () => {
  it("每个类型都有字母与标题", () => {
    const cases: { kind: "rust" | "node" | "python" | "java" | "csharp" | "go" | "unity" | "generic"; letter: string }[] = [
      { kind: "rust", letter: "R" },
      { kind: "node", letter: "N" },
      { kind: "python", letter: "Py" },
      { kind: "java", letter: "J" },
      { kind: "csharp", letter: "C#" },
      { kind: "go", letter: "Go" },
      { kind: "unity", letter: "U" },
      { kind: "generic", letter: "F" },
    ];
    for (const { kind, letter } of cases) {
      const { unmount } = render(<ProjectKindBadge kind={kind} />);
      expect(screen.getByTitle(/./)).toHaveTextContent(letter);
      unmount();
    }
  });
});
