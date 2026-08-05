import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("hover 后延迟显示，移出/Esc 关闭", async () => {
    render(
      <Tooltip content="归档当前文件">
        <button type="button">Hover me</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("Hover me"));
    expect(await screen.findByText("归档当前文件")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByText("归档当前文件")).not.toBeInTheDocument(),
    );
  });

  it("空内容不显示提示", async () => {
    render(
      <Tooltip content="">
        <button type="button">Empty</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Empty"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
