import { Sparkles } from "../theme/icons";
import {
  LABEL_COLOR_KEYS,
  LABEL_COLORS,
  type LabelColorKey,
} from "../lib/labelDefs";

/**
 * 统一颜色选择器：复用 12 色板；allowAuto 时提供“自动”选项。
 * 颜色是标签/课程自身属性，不是皮肤令牌，皮肤可整体覆盖色板。
 */
export function ColorPicker({
  value,
  onChange,
  allowAuto = false,
  autoLabel = "自动",
  size = "sm",
}: {
  value: LabelColorKey | "auto";
  onChange: (value: LabelColorKey | "auto") => void;
  allowAuto?: boolean;
  autoLabel?: string;
  size?: "sm" | "md";
}) {
  const swatch = size === "md" ? "size-7" : "size-6";
  const autoIcon = size === "md" ? "size-3.5" : "size-3";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowAuto && (
        <button
          type="button"
          aria-pressed={value === "auto"}
          title={autoLabel}
          aria-label={autoLabel}
          onClick={() => onChange("auto")}
          className={`flex ${swatch} items-center justify-center rounded-full bg-gradient-to-br from-slate-200 via-white to-slate-400 transition-transform dark:from-slate-600 dark:via-slate-700 dark:to-slate-500 ${
            value === "auto"
              ? "ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-900"
              : "hover:scale-110"
          }`}
        >
          <Sparkles
            className={`${autoIcon} text-slate-500 dark:text-slate-300`}
          />
        </button>
      )}
      {LABEL_COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          title={key}
          aria-label={key}
          onClick={() => onChange(key)}
          className={`${swatch} rounded-full ${LABEL_COLORS[key].dot} transition-transform ${
            value === key
              ? "ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-900"
              : "hover:scale-110"
          }`}
        />
      ))}
    </div>
  );
}
