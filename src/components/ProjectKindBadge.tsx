import { useTranslation } from "react-i18next";
import type { ProjectKind } from "../lib/tauri";

export const PROJECT_KIND_LABEL_KEY: Record<ProjectKind, string> = {
  rust: "projects.kindRust",
  node: "projects.kindNode",
  python: "projects.kindPython",
  java: "projects.kindJava",
  csharp: "projects.kindCSharp",
  go: "projects.kindGo",
  unity: "projects.kindUnity",
  generic: "projects.kindGeneric",
};

const KIND_STYLE: Record<ProjectKind, { letter: string; className: string }> = {
  rust: { letter: "R", className: "bg-[#CE422B] text-white" },
  node: { letter: "N", className: "bg-[#339933] text-white" },
  python: { letter: "Py", className: "bg-[#3776AB] text-white" },
  java: { letter: "J", className: "bg-[#F89820] text-white" },
  csharp: { letter: "C#", className: "bg-[#68217A] text-white" },
  go: { letter: "Go", className: "bg-[#00ADD8] text-white" },
  unity: { letter: "U", className: "bg-[#222C37] text-white" },
  generic: { letter: "F", className: "bg-slate-400 text-white" },
};

/** 项目类型字母徽章（辨识度优先，颜色/字母与快捷方式图标一致）。 */
export function ProjectKindBadge({
  kind,
  size = "md",
}: {
  kind: ProjectKind;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const meta = KIND_STYLE[kind] ?? KIND_STYLE.generic;
  return (
    <span
      title={t(PROJECT_KIND_LABEL_KEY[kind])}
      className={`flex shrink-0 items-center justify-center rounded-md font-bold ${size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs"} ${meta.className}`}
    >
      {meta.letter}
    </span>
  );
}
