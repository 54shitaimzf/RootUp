import {
  BookOpen,
  Briefcase,
  Cloud,
  Code2,
  Coffee,
  Database,
  FileText,
  FlaskConical,
  GraduationCap,
  Heart,
  Layers,
  Leaf,
  Lightbulb,
  Music,
  Palette,
  Rocket,
  Star,
  Tag,
  Trophy,
  Wrench,
  type LucideIcon,
} from "../theme/icons";

/** 预设标签图标注册表（lucide 线性图标，统一矢量方案；未知 key 回退 Tag）。 */
export const LABEL_ICONS: Record<string, LucideIcon> = {
  tag: Tag,
  star: Star,
  book: BookOpen,
  graduation: GraduationCap,
  flask: FlaskConical,
  wrench: Wrench,
  rocket: Rocket,
  bulb: Lightbulb,
  heart: Heart,
  music: Music,
  leaf: Leaf,
  coffee: Coffee,
  briefcase: Briefcase,
  palette: Palette,
  database: Database,
  code: Code2,
  file: FileText,
  layers: Layers,
  trophy: Trophy,
  cloud: Cloud,
};

export const DEFAULT_LABEL_ICON = "tag";

/** 解析图标 key：未知值回退默认。 */
export function labelIconKey(key?: string): string {
  return key && key in LABEL_ICONS ? key : DEFAULT_LABEL_ICON;
}

/** 预设标签色板（12 色）：浅/深主题 class 与色点 class 成对，皮肤可整体覆盖。 */
export const LABEL_COLORS = {
  slate: {
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    dot: "bg-slate-500 dark:bg-slate-400",
  },
  sky: {
    chip: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
    dot: "bg-sky-500 dark:bg-sky-400",
  },
  violet: {
    chip: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  rose: {
    chip: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
    dot: "bg-rose-500 dark:bg-rose-400",
  },
  amber: {
    chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  orange: {
    chip: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
    dot: "bg-orange-500 dark:bg-orange-400",
  },
  emerald: {
    chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  blue: {
    chip: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  teal: {
    chip: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
    dot: "bg-teal-500 dark:bg-teal-400",
  },
  lime: {
    chip: "bg-lime-100 text-lime-600 dark:bg-lime-500/15 dark:text-lime-400",
    dot: "bg-lime-500 dark:bg-lime-400",
  },
  cyan: {
    chip: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400",
    dot: "bg-cyan-500 dark:bg-cyan-400",
  },
  fuchsia: {
    chip: "bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400",
    dot: "bg-fuchsia-500 dark:bg-fuchsia-400",
  },
} as const;

export type LabelColorKey = keyof typeof LABEL_COLORS;

export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColorKey[];

export const DEFAULT_LABEL_COLOR = "slate";

/** 解析颜色 key：未知值回退默认。 */
export function labelColorKey(key?: string): LabelColorKey {
  return key && key in LABEL_COLORS ? (key as LabelColorKey) : DEFAULT_LABEL_COLOR;
}
