import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchAutocomplete } from "./SearchAutocomplete";
import type { FilterHabits } from "../lib/filterHabits";
import {
  type FilterTags,
  type Suggestion,
  type TagValue,
} from "../lib/autocomplete";

vi.mock("../lib/tauri", () => ({
  logEvent: vi.fn(),
}));

const CANDIDATES: Suggestion[] = [
  {
    kind: "category",
    key: "category:archive",
    raw: "archive",
    token: "type:archive",
    display: "压缩包",
  },
  {
    kind: "category",
    key: "category:document",
    raw: "document",
    token: "type:document",
    display: "文档",
  },
  {
    kind: "category",
    key: "category:data",
    raw: "data",
    token: "type:data",
    display: "数据",
  },
  {
    kind: "label",
    key: "label:高数",
    raw: "高数",
    token: "label:高数",
    display: "高数",
  },
];

interface Callbacks {
  onTextChange?: (value: string) => void;
  onTagsChange?: (tags: FilterTags) => void;
  onInsert?: (suggestion: Suggestion) => void;
  onHabitUsed?: (key: string) => void;
  onTagAdd?: (tag: TagValue) => void;
  onTagRemove?: (tag: TagValue) => void;
}

function Harness({
  text = "",
  types = [],
  states = [],
  labels = [],
  habits = {},
  labelDefs = {},
  callbacks = {},
}: {
  text?: string;
  types?: string[];
  states?: string[];
  labels?: string[];
  habits?: FilterHabits;
  labelDefs?: Record<
    string,
    { key: string; name: string; icon: string; color: string }
  >;
  callbacks?: Callbacks;
}) {
  const [value, setValue] = useState(text);
  const [tags, setTags] = useState<FilterTags>({ types, states, labels });
  return (
    <SearchAutocomplete
      text={value}
      types={tags.types}
      states={tags.states}
      labels={tags.labels}
      candidates={CANDIDATES}
      habits={habits}
      labelDefs={labelDefs}
      onTextChange={(next) => {
        callbacks.onTextChange?.(next);
        setValue(next);
      }}
      onTagsChange={(next) => {
        callbacks.onTagsChange?.(next);
        setTags(next);
      }}
      onInsert={callbacks.onInsert}
      onHabitUsed={callbacks.onHabitUsed}
      onTagAdd={callbacks.onTagAdd}
      onTagRemove={callbacks.onTagRemove}
    />
  );
}

function input() {
  return screen.getByPlaceholderText("搜索文件…");
}

describe("SearchAutocomplete", () => {
  it("输入后显示下拉，Tab 补全第一个候选并产生标签", () => {
    const onTextChange = vi.fn();
    const onTagsChange = vi.fn();
    const onTagAdd = vi.fn();
    const onHabitUsed = vi.fn();
    render(<Harness callbacks={{ onTextChange, onTagsChange, onTagAdd, onHabitUsed }} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "a" } });
    expect(screen.getByText("压缩包")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(onTextChange).toHaveBeenCalledWith("");
    expect(onTagsChange).toHaveBeenCalledWith({
      types: ["archive"],
      states: [],
      labels: [],
    });
    expect(onTagAdd).toHaveBeenCalledWith({ kind: "category", value: "archive" });
    expect(onHabitUsed).toHaveBeenCalledWith("category:archive");
  });

  it("Enter 应用高亮项（默认第一个）", () => {
    const onTagsChange = vi.fn();
    render(<Harness callbacks={{ onTagsChange }} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "a" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onTagsChange).toHaveBeenCalledWith({
      types: ["archive"],
      states: [],
      labels: [],
    });
  });

  it("ArrowDown 切换高亮后 Enter 应用第二个", async () => {
    const onTagsChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness callbacks={{ onTagsChange }} />);
    await user.click(input());
    await user.keyboard("a");
    expect(screen.getByText("压缩包")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    const suggestionsButtons = screen
      .getAllByRole("button")
      .filter((button) =>
        ["压缩包", "数据"].some((name) => button.textContent?.includes(name)),
      );
    expect(suggestionsButtons[1].className).toContain("bg-slate-100");
    await user.keyboard("{Enter}");
    expect(onTagsChange).toHaveBeenCalledWith({
      types: ["data"],
      states: [],
      labels: [],
    });
  });

  it("Esc 关闭下拉", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "a" } });
    expect(screen.getByText("压缩包")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByText("压缩包")).not.toBeInTheDocument();
  });

  it("无建议时 Enter 不补全也不报错", () => {
    const onTextChange = vi.fn();
    render(<Harness callbacks={{ onTextChange }} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "zzz" } });
    onTextChange.mockClear();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onTextChange).not.toHaveBeenCalled();
  });

  it("标签渲染并可点击 × 删除", () => {
    const onTagsChange = vi.fn();
    const onTagRemove = vi.fn();
    render(
      <Harness
        types={["document"]}
        callbacks={{ onTagsChange, onTagRemove }}
      />,
    );
    expect(screen.getByText("文档")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("移除该筛选"));
    expect(onTagsChange).toHaveBeenCalledWith({
      types: [],
      states: [],
      labels: [],
    });
    expect(onTagRemove).toHaveBeenCalledWith({
      kind: "category",
      value: "document",
    });
  });

  it("自定义标签 chip 显示注册表名称", () => {
    render(
      <Harness
        labels={["course"]}
        labelDefs={{
          course: { key: "course", name: "课程资料", icon: "book", color: "sky" },
        }}
      />,
    );
    expect(screen.getByText("课程资料")).toBeInTheDocument();
  });

  it("文本为空时 Backspace 删除最后一个标签", () => {
    const onTagsChange = vi.fn();
    const onTagRemove = vi.fn();
    render(
      <Harness labels={["高数"]} callbacks={{ onTagsChange, onTagRemove }} />,
    );
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onTagsChange).toHaveBeenCalledWith({
      types: [],
      states: [],
      labels: [],
    });
    expect(onTagRemove).toHaveBeenCalledWith({ kind: "label", value: "高数" });
  });

  it("清空按钮清空文本与标签", () => {
    const onTextChange = vi.fn();
    const onTagsChange = vi.fn();
    render(
      <Harness
        text="x"
        types={["document"]}
        callbacks={{ onTextChange, onTagsChange }}
      />,
    );
    fireEvent.click(screen.getByLabelText("清空搜索"));
    expect(onTextChange).toHaveBeenCalledWith("");
    expect(onTagsChange).toHaveBeenCalledWith({
      types: [],
      states: [],
      labels: [],
    });
  });

  it("点击搜索容器空白处聚焦输入框", () => {
    const { container } = render(<Harness types={["document"]} />);
    const wrapper = container.querySelector(".relative") as HTMLElement;
    fireEvent.click(wrapper);
    expect(document.activeElement).toBe(input());
  });

  it("有标签后输入仍显示下拉", () => {
    render(<Harness types={["document"]} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "a" } });
    expect(screen.getByText("压缩包")).toBeInTheDocument();
  });
});
