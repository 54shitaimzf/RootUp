import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

export type BannerVariant = "brand" | "warn" | "error" | "info";

const VARIANT_CLASSES: Record<BannerVariant, string> = {
  brand:
    "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300",
  warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  error:
    "border-red-200 bg-red-50 text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-400",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300",
};

/** 统一横幅：brand / warn / error，可选关闭按钮；间距由调用方 className 控制。 */
export function Banner({
  variant,
  onClose,
  actions,
  padding = "md",
  className = "",
  children,
}: {
  variant: BannerVariant;
  onClose?: () => void;
  actions?: ReactNode;
  padding?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 text-sm ${padding === "sm" ? "py-2.5" : "py-3"} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t("settings.dialogClose")}
          className="shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
