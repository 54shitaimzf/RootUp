import { Tag, type LucideIcon } from "lucide-react";
import { LABEL_ICONS, labelIconKey } from "../lib/labelDefs";

/** 自定义标签图标统一入口（未知 key 回退 Tag），矢量单一来源。 */
export function LabelIcon({
  icon,
  className = "size-3.5 shrink-0",
}: {
  icon?: string;
  className?: string;
}) {
  const Icon: LucideIcon = LABEL_ICONS[labelIconKey(icon)] ?? Tag;
  return <Icon aria-hidden="true" className={className} />;
}
