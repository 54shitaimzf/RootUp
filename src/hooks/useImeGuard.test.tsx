import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useImeGuard } from "./useImeGuard";

function Harness() {
  useImeGuard();
  return (
    <div>
      <input data-testid="editable" />
      <button type="button" data-testid="button">
        按钮
      </button>
    </div>
  );
}

describe("useImeGuard", () => {
  it("窗口失焦时释放输入框焦点", () => {
    render(<Harness />);
    const input = screen.getByTestId("editable");
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.blur(window);
    expect(document.activeElement).not.toBe(input);
  });

  it("窗口失焦时不影响非编辑元素", () => {
    render(<Harness />);
    const button = screen.getByTestId("button");
    button.focus();
    fireEvent.blur(window);
    expect(document.activeElement).toBe(button);
  });
});
