import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArchiveConfirmDialog } from "./ArchiveConfirmDialog";
import {
  revealInExplorer,
  type FileRecord,
  type PreflightReport,
} from "../../../lib/tauri";

vi.mock("../../../lib/tauri", () => ({
  revealInExplorer: vi.fn(async () => {}),
}));

function file(name: string, labels = "document"): FileRecord {
  return {
    id: 0,
    path: `C:/d/${name}`,
    name,
    size: 1,
    file_type: "txt",
    labels,
    first_seen: 0,
    modified: 0,
    state: "indexed",
  };
}

const items = ["a.pdf", "b.docx", "c.pdf", "d.png", "e.jpg"].map((n) =>
  file(n),
);
const selected = new Set(items.map((f) => f.path));

function renderDialog(overrides?: {
  target?: { mode: "selected" | "filtered"; count: number } | null;
  items?: FileRecord[];
  selected?: Set<string>;
  preflight?: PreflightReport | null;
  riskConfirmed?: boolean;
}) {
  const {
    target = { mode: "selected", count: 5 },
    items: list = items,
    selected: sel = selected,
    preflight: report = null,
    riskConfirmed = false,
  } = overrides ?? {};
  return render(
    <ArchiveConfirmDialog
      target={target}
      archiveRoot="C:/Arc"
      items={list}
      selected={sel}
      preflight={report}
      riskConfirmed={riskConfirmed}
      onRiskConfirmChange={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("ArchiveConfirmDialog", () => {
  it("所选模式摘要：档案库链接 + 前 3 个文件名 + 查看全部", () => {
    renderDialog();
    expect(
      screen.getByText("将归档 5 个文件，归档后可随时撤销。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "档案库 (C:/Arc)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("c.pdf")).toBeInTheDocument();
    expect(screen.queryByText("d.png")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看全部 5 个文件" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档 5 个文件" }));
  });

  it("悬浮文件名显示完整目标路径", async () => {
    renderDialog();
    fireEvent.mouseEnter(screen.getByText("a.pdf"));
    expect(await screen.findByText("C:/Arc/document/a.pdf")).toBeInTheDocument();
  });

  it("不超过 3 个时没有查看全部按钮", () => {
    const two = items.slice(0, 2);
    renderDialog({
      target: { mode: "selected", count: 2 },
      items: two,
      selected: new Set(two.map((f) => f.path)),
    });
    expect(
      screen.queryByRole("button", { name: /查看全部/ }),
    ).not.toBeInTheDocument();
  });

  it("切换到完整列表视图并可返回，确认按钮两视图常在", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "查看全部 5 个文件" }));
    expect(screen.getByText("待归档文件（5）")).toBeInTheDocument();
    for (const name of ["a.pdf", "b.docx", "c.pdf", "d.png", "e.jpg"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "归档 5 个文件" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByText("确认归档")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档 5 个文件" }));
  });

  it("筛选模式只显示数量与档案库，无文件列表", () => {
    renderDialog({ target: { mode: "filtered", count: 12 } });
    expect(
      screen.getByText("将归档当前筛选的全部 12 个文件，归档后可随时撤销。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "档案库 (C:/Arc)" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /查看全部/ }),
    ).not.toBeInTheDocument();
  });

  it("筛选模式计数未知（total=-1 钳为 0）时使用无计数文案", () => {
    renderDialog({ target: { mode: "filtered", count: 0 } });
    expect(
      screen.getByText("将归档当前筛选的全部文件，归档后可随时撤销。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "归档文件" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/-1/)).not.toBeInTheDocument();
  });

  it("点击档案库在资源管理器定位归档根", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "档案库 (C:/Arc)" }));
    await waitFor(() =>
      expect(revealInExplorer).toHaveBeenCalledWith("C:/Arc"),
    );
  });

  it("预检报告展示数量/体积/可执行与快捷方式风险", () => {
    const report: PreflightReport = {
      count: 120,
      totalSize: 5 * 1024 * 1024,
      exeCount: 2,
      dllCount: 3,
      symlinkCount: 1,
      truncated: false,
      softwareUnits: [],
      shortcuts: ["C:/Users/x/Desktop/a.lnk"],
    };
    renderDialog({ preflight: report });
    expect(screen.getByText(/共 120 项/)).toBeInTheDocument();
    expect(screen.getByText(/可执行 2 · 动态库 3/)).toBeInTheDocument();
    expect(screen.getByText("符号链接 1")).toBeInTheDocument();
    expect(screen.getByText("1 个快捷方式指向所选内容，归档后将失效")).toBeInTheDocument();
    // 无软件冲突：确认按钮可用，无风险勾选
    expect(screen.getByRole("button", { name: "归档 5 个文件" })).toBeEnabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("软件冲突需勾选风险确认后才能归档", () => {
    const report: PreflightReport = {
      count: 9,
      totalSize: 1024,
      exeCount: 1,
      dllCount: 0,
      symlinkCount: 0,
      truncated: false,
      softwareUnits: ["C:/Watch/SomeApp"],
      shortcuts: [],
    };
    const view = renderDialog({ preflight: report, riskConfirmed: false });
    expect(screen.getByText(/已识别为软件组件/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档 5 个文件" })).toBeDisabled();
    view.unmount();
    // 勾选风险确认后可归档
    renderDialog({ preflight: report, riskConfirmed: true });
    expect(screen.getByRole("button", { name: "归档 5 个文件" })).toBeEnabled();
  });
});
