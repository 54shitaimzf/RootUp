import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectOpenDialog, type OpenConfig } from "./ProjectOpenDialog";

vi.mock("../../../lib/tauri", () => ({
  listDetectedTools: vi.fn(),
}));

import { listDetectedTools } from "../../../lib/tauri";

const INITIAL: OpenConfig = {
  preferredIde: "auto",
  customOpenCommands: [],
};

describe("ProjectOpenDialog", () => {
  it("渲染首选 IDE 下拉并保存", async () => {
    vi.mocked(listDetectedTools).mockResolvedValue(["vscode"]);
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ProjectOpenDialog
        open
        initial={INITIAL}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "vscode" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        preferredIde: "vscode",
        customOpenCommands: [],
      });
    });
  });

  it("添加与删除自定义命令", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectOpenDialog
        open
        initial={INITIAL}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("名称"), {
      target: { value: "Typora" },
    });
    fireEvent.change(screen.getByPlaceholderText("命令（可执行文件路径）"), {
      target: { value: "C:/Typora/Typora.exe" },
    });
    fireEvent.change(screen.getByPlaceholderText("用途（可空）"), {
      target: { value: "typora" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加命令" }));
    expect(screen.getByText("Typora")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("移除"));
    expect(screen.queryByText("Typora")).not.toBeInTheDocument();
  });

  it("空名称/命令拒绝添加", () => {
    render(
      <ProjectOpenDialog
        open
        initial={INITIAL}
        onSave={() => Promise.resolve()}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加命令" }));
    expect(
      screen.getByText("名称与命令不能为空（名称 ≤40、命令 ≤260 字符）"),
    ).toBeInTheDocument();
  });
});
