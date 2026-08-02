import {
  Archive,
  Code2,
  Database,
  File,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Package,
  type LucideIcon,
} from "lucide-react";

/** 类别 → 图标映射（筛选器与文件行共用；未来可整体替换为自定义 SVG） */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  document: FileText,
  image: ImageIcon,
  video: Film,
  audio: Music,
  archive: Archive,
  code: Code2,
  installer: Package,
  data: Database,
  other: File,
};

/** 类别 → 深浅主题适配的圆底配色 */
const CATEGORY_COLOR: Record<string, string> = {
  document:
    "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  image:
    "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  video: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  audio:
    "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  archive:
    "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
  code: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  installer:
    "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  data: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
  other: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
};

export const DEFAULT_CATEGORY = "other";

export function FileTypeIcon({
  category,
  size = "md",
  title,
}: {
  category?: string | null;
  size?: "sm" | "md";
  title?: string;
}) {
  const key = category && CATEGORY_ICON[category] ? category : DEFAULT_CATEGORY;
  const Icon = CATEGORY_ICON[key];
  const color = CATEGORY_COLOR[key] ?? CATEGORY_COLOR[DEFAULT_CATEGORY];
  const boxClass = size === "sm" ? "size-7 rounded-md" : "size-9 rounded-lg";
  const iconClass = size === "sm" ? "size-4" : "size-5";
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`flex ${boxClass} shrink-0 items-center justify-center ${color}`}
    >
      <Icon className={iconClass} />
    </span>
  );
}
