import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LabelManageDialog } from "./LabelManageDialog";
import type { LabelDef } from "../../../lib/tauri";

vi.mock("../../../lib/tauri", () => ({
  saveLabelDef: vi.fn(),
  deleteLabelDef: vi.fn(),
}));

import { deleteLabelDef, saveLabelDef } from "../../../lib/tauri";

const LABELS: LabelDef[] = [
  { key: "course", name: "课程资料", icon: "book", color: "sky" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog(
  overrides: Partial<Parameters<typeof LabelManageDialog>[0]> = {},
) {
  const props = {
    open: true,
    categories: ["document", "image"],
    labels: LABELS,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
  render(<LabelManageDialog {...props} />);
  return props;
}

describe("LabelManageDialog", () => {
  it("渲染内置大类（只读）与自定义标签列表", () => {
    renderDialog();
    expect(screen.getByText("文档")).toBeInTheDocument();
    expect(screen.getByText("图片")).toBeInTheDocument();
    expect(screen.getByText("课程资料")).toBeInTheDocument();
    expect(screen.getByText("course")).toBeInTheDocument();
  });

  it("新建标签：名称自动生成 key，可选图标与颜色并保存", async () => {
    vi.mocked(saveLabelDef).mockResolvedValue({
      key: "course-notes",
      name: "Course Notes",
      icon: "book",
      color: "sky",
    });
    const onChanged = vi.fn();
    renderDialog({ onChanged });

    fireEvent.click(screen.getByRole("button", { name: "新建标签" }));
    fireEvent.change(screen.getByPlaceholderText("如：课程资料"), {
      target: { value: "Course Notes" },
    });
    const keyInput = screen.getByPlaceholderText("如：course") as HTMLInputElement;
    expect(keyInput.value).toBe("course-notes");

    fireEvent.click(screen.getByRole("button", { name: "book" }));
    fireEvent.click(screen.getByRole("button", { name: "sky" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(saveLabelDef).toHaveBeenCalledWith({
        key: "course-notes",
        name: "Course Notes",
        icon: "book",
        color: "sky",
      });
    });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText("Course Notes")).toBeInTheDocument();
  });

  it("空表单拒绝保存并提示", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "新建标签" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/名称与 key 不能为空/)).toBeInTheDocument();
    expect(saveLabelDef).not.toHaveBeenCalled();
  });

  it("编辑标签：key 只读，保存后更新列表", async () => {
    vi.mocked(saveLabelDef).mockResolvedValue({
      key: "course",
      name: "课程资料（改）",
      icon: "book",
      color: "sky",
    });
    renderDialog();

    fireEvent.click(screen.getByLabelText("编辑标签"));
    const keyInput = screen.getByPlaceholderText("如：course") as HTMLInputElement;
    expect(keyInput.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("如：课程资料"), {
      target: { value: "课程资料（改）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(saveLabelDef).toHaveBeenCalledWith({
        key: "course",
        name: "课程资料（改）",
        icon: "book",
        color: "sky",
      });
    });
    expect(screen.getByText("课程资料（改）")).toBeInTheDocument();
  });

  it("删除标签需确认，确认后调用删除并刷新", async () => {
    vi.mocked(deleteLabelDef).mockResolvedValue(undefined);
    const onChanged = vi.fn();
    renderDialog({ onChanged });

    fireEvent.click(screen.getByLabelText("删除标签"));
    expect(screen.getByText(/确认删除标签/)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", {
      name: "删除标签",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(deleteLabelDef).toHaveBeenCalledWith("course");
    });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText("课程资料")).not.toBeInTheDocument();
  });

  it("后端错误展示在提示条", async () => {
    vi.mocked(saveLabelDef).mockRejectedValue(new Error("标签名称已存在"));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "新建标签" }));
    fireEvent.change(screen.getByPlaceholderText("如：课程资料"), {
      target: { value: "数学" },
    });
    fireEvent.change(screen.getByPlaceholderText("如：course"), {
      target: { value: "math" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/标签名称已存在/)).toBeInTheDocument();
  });
});
