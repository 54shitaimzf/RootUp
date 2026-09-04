import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { FilterBar } from "./FilterBar";
import type { FilterHabits } from "../lib/filterHabits";

vi.mock("../lib/tauri", () => ({
  logEvent: vi.fn(),
}));

function textOrder(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "")
    .filter(Boolean);
}

describe("FilterBar", () => {
  it("按频率快照排序：全部置前，count 降序", () => {
    const habits: FilterHabits = {
      "category:document": { count: 1, lastUsed: 200 },
      "category:image": { count: 5, lastUsed: 100 },
    };
    render(
      <FilterBar
        categories={["document", "image"]}
        labels={[]}
        selectedCategories={[]}
        selectedLabels={[]}
        habits={habits}
        onHabitUsed={() => {}}
        onCategoriesChange={() => {}}
        onLabelsChange={() => {}}
      />,
    );
    const all = i18n.t("filter.all");
    const image = i18n.t("filter.image");
    const document = i18n.t("filter.document");
    expect(textOrder()).toEqual([`ALL${all}`, image, document]);
  });

  it("已选类别置前", () => {
    const habits: FilterHabits = {
      "category:image": { count: 5, lastUsed: 100 },
      "category:document": { count: 1, lastUsed: 200 },
    };
    render(
      <FilterBar
        categories={["document", "image"]}
        labels={[]}
        selectedCategories={["document"]}
        selectedLabels={[]}
        habits={habits}
        onHabitUsed={() => {}}
        onCategoriesChange={() => {}}
        onLabelsChange={() => {}}
      />,
    );
    const all = i18n.t("filter.all");
    const image = i18n.t("filter.image");
    const document = i18n.t("filter.document");
    expect(textOrder()).toEqual([`ALL${all}`, document, image]);
  });

  it("点击类别 chip 切换选中并记录习惯", () => {
    const onCategoriesChange = vi.fn();
    const onHabitUsed = vi.fn();
    render(
      <FilterBar
        categories={["document"]}
        labels={[]}
        selectedCategories={[]}
        selectedLabels={[]}
        habits={{}}
        onHabitUsed={onHabitUsed}
        onCategoriesChange={onCategoriesChange}
        onLabelsChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(i18n.t("filter.document")));
    expect(onHabitUsed).toHaveBeenCalledWith("category:document");
    expect(onCategoriesChange).toHaveBeenCalledWith(["document"]);
  });

  it("点击标签 chip 追加/移除并记录习惯", () => {
    const onLabelsChange = vi.fn();
    const onHabitUsed = vi.fn();
    render(
      <FilterBar
        categories={[]}
        labels={["高数"]}
        selectedCategories={[]}
        selectedLabels={["高数"]}
        habits={{}}
        onHabitUsed={onHabitUsed}
        onCategoriesChange={() => {}}
        onLabelsChange={onLabelsChange}
      />,
    );
    fireEvent.click(screen.getByText("高数"));
    expect(onHabitUsed).toHaveBeenCalledWith("label:高数");
    expect(onLabelsChange).toHaveBeenCalledWith([]);
  });

  it("标签为空时不渲染标签行", () => {
    render(
      <FilterBar
        categories={["document"]}
        labels={[]}
        selectedCategories={[]}
        selectedLabels={[]}
        habits={{}}
        onHabitUsed={() => {}}
        onCategoriesChange={() => {}}
        onLabelsChange={() => {}}
      />,
    );
    expect(screen.queryByText(i18n.t("filter.labels"))).not.toBeInTheDocument();
  });

  it("自定义标签显示注册表名称，未注册标签回退原文", () => {
    render(
      <FilterBar
        categories={[]}
        labels={["course", "unknown"]}
        selectedCategories={[]}
        selectedLabels={[]}
        habits={{}}
        labelDefs={{
          course: { key: "course", name: "课程资料", icon: "book", color: "sky" },
        }}
        onHabitUsed={() => {}}
        onCategoriesChange={() => {}}
        onLabelsChange={() => {}}
      />,
    );
    expect(screen.getByText("课程资料")).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });
});
