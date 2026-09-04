import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RevealLink } from "./RevealLink";
import { revealInExplorer } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  revealInExplorer: vi.fn(async () => {}),
}));

describe("RevealLink", () => {
  it("渲染友好名链接，悬浮显示完整路径", async () => {
    render(<RevealLink label="档案库" path="C:/Arc" />);
    const link = screen.getByRole("button", { name: "档案库 (C:/Arc)" });
    expect(link.className).toContain("underline");
    expect(screen.queryByText("C:/Arc")).not.toBeInTheDocument();
    fireEvent.mouseEnter(link);
    expect(await screen.findByText("C:/Arc")).toBeInTheDocument();
  });

  it("tooltipPath 优先于 path 作为悬浮内容", async () => {
    render(
      <RevealLink
        label="档案库"
        path="C:/Arc"
        tooltipPath="C:/Arc/项目/demo"
      />,
    );
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "档案库 (C:/Arc/项目/demo)" }),
    );
    expect(await screen.findByText("C:/Arc/项目/demo")).toBeInTheDocument();
  });

  it("点击调用 revealInExplorer(path) 并阻止冒泡", async () => {
    const bubbled = vi.fn();
    render(
      <div onClick={bubbled}>
        <RevealLink label="档案库" path="C:/Arc" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "档案库 (C:/Arc)" }));
    await waitFor(() =>
      expect(revealInExplorer).toHaveBeenCalledWith("C:/Arc"),
    );
    expect(bubbled).not.toHaveBeenCalled();
  });

  it("定位失败时静默不抛错", async () => {
    vi.mocked(revealInExplorer).mockRejectedValueOnce("路径不存在");
    render(<RevealLink label="档案库" path="C:/missing" />);
    fireEvent.click(
      screen.getByRole("button", { name: "档案库 (C:/missing)" }),
    );
    await waitFor(() =>
      expect(revealInExplorer).toHaveBeenCalledWith("C:/missing"),
    );
  });
});
