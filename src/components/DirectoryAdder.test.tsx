import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DirectoryAdder } from "./DirectoryAdder";

vi.mock("../lib/tauri", () => ({
  openDirectoryDialog: vi.fn(),
  resolveDirTarget: vi.fn(),
}));

const dragMock = vi.hoisted(() => ({
  handler: undefined as
    | ((event: {
        type: string;
        payload: { type: string; paths: string[] };
      }) => void)
    | undefined,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler: typeof dragMock.handler) => {
      dragMock.handler = handler;
      return () => {};
    }),
  }),
}));

import { openDirectoryDialog, resolveDirTarget } from "../lib/tauri";

function renderAdder(
  onAdd: (dir: string) => Promise<string | null> = async () => null,
) {
  return render(
    <DirectoryAdder
      placeholder="输入目录路径"
      hint="支持拖拽"
      addLabel="添加"
      browseLabel="浏览…"
      commonDirs={[
        { path: "C:/Users/x/Downloads", kind: "downloads" },
      ]}
      onAdd={onAdd}
    />,
  );
}

describe("DirectoryAdder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openDirectoryDialog).mockResolvedValue(null);
    vi.mocked(resolveDirTarget).mockImplementation(async (path) => path);
  });

  it("粘贴引号路径清洗后提交并清空输入", async () => {
    const onAdd = vi.fn(async () => null);
    renderAdder(onAdd);
    fireEvent.change(screen.getByPlaceholderText("输入目录路径"), {
      target: { value: '"C:/x"' },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("C:/x"));
    expect(screen.getByPlaceholderText("输入目录路径")).toHaveValue("");
  });

  it("空输入点击添加不提交", () => {
    const onAdd = vi.fn(async () => null);
    renderAdder(onAdd);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("浏览选择目录后提交", async () => {
    const onAdd = vi.fn(async () => null);
    vi.mocked(openDirectoryDialog).mockResolvedValue("D:/picked");
    renderAdder(onAdd);
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("D:/picked"));
  });

  it("拖入文件先解析父目录再提交", async () => {
    const onAdd = vi.fn(async () => null);
    renderAdder(onAdd);
    await waitFor(() => expect(dragMock.handler).toBeDefined());
    dragMock.handler?.({
      type: "drop",
      payload: { type: "drop", paths: ["C:/Drop/notes.pdf"] },
    });
    await waitFor(() =>
      expect(resolveDirTarget).toHaveBeenCalledWith("C:/Drop/notes.pdf"),
    );
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("C:/Drop/notes.pdf"));
  });

  it("常用目录 chip 一键提交", async () => {
    const onAdd = vi.fn(async () => null);
    renderAdder(onAdd);
    fireEvent.click(screen.getByText("下载"));
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith("C:/Users/x/Downloads"),
    );
  });

  it("提交失败显示错误，重新输入时清除", async () => {
    const onAdd = vi.fn(async () => "目录不存在: C:/nope");
    renderAdder(onAdd);
    fireEvent.change(screen.getByPlaceholderText("输入目录路径"), {
      target: { value: "C:/nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByText("目录不存在: C:/nope")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("输入目录路径"), {
      target: { value: "C:/ok" },
    });
    expect(screen.queryByText("目录不存在: C:/nope")).not.toBeInTheDocument();
  });
});
