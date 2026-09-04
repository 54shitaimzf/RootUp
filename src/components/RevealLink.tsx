import { Archive } from "../theme/icons";
import { revealInExplorer } from "../lib/tauri";
import { Tooltip } from "./Tooltip";

/**
 * 友好名路径链接：点击在资源管理器中定位 path（best-effort，路径不存在时静默），
 * 悬浮经唯一悬浮提示组件显示完整路径（tooltipPath 缺省同 path）。
 * 归档目的地的展示约定：界面只出现「档案库」友好名，完整路径一律走本组件悬浮。
 */
export function RevealLink({
  label,
  path,
  tooltipPath,
  icon = true,
  className = "",
}: {
  label: string;
  path: string;
  /** 悬浮提示展示的路径；与点击定位的 path 分离（如目标尚未创建时提示精确目标）。 */
  tooltipPath?: string;
  icon?: boolean;
  className?: string;
}) {
  const full = tooltipPath ?? path;
  return (
    <Tooltip content={full} className="inline">
      <button
        type="button"
        aria-label={`${label} (${full})`}
        onClick={(event) => {
          event.stopPropagation();
          void revealInExplorer(path).catch(() => {});
        }}
        className={`inline-flex items-center gap-1 font-medium text-brand-700 underline decoration-brand-400/50 underline-offset-2 transition-colors hover:text-brand-600 hover:decoration-brand-500 focus-visible:text-brand-600 focus-visible:outline-none dark:text-brand-300 dark:hover:text-brand-200 ${className}`}
      >
        {icon && <Archive aria-hidden="true" className="size-3.5 shrink-0" />}
        {label}
      </button>
    </Tooltip>
  );
}
