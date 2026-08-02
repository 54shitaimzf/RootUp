import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

/**
 * 两步确认按钮：第一次点击进入 pending 态（默认琥珀色），再次点击才触发 onConfirm。
 *
 * 标准场景：传 variant / pendingVariant / label / pendingLabel。
 * 特殊场景（如图标按钮 morph 为文字确认）：传 pendingClassName 后，
 * 由调用方提供 idle/pending 两套完整 class，组件只负责状态切换。
 */
export function ConfirmButton({
  label,
  pendingLabel,
  onConfirm,
  variant = "primary",
  pendingVariant = "amber",
  size = "sm",
  className = "",
  pendingClassName = "",
  icon,
  disabled = false,
}: {
  label: ReactNode;
  pendingLabel: ReactNode;
  onConfirm: () => void;
  variant?: ButtonVariant;
  pendingVariant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  pendingClassName?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  const click = () => {
    if (disabled) return;
    if (!pending) {
      setPending(true);
      return;
    }
    setPending(false);
    onConfirm();
  };

  if (pendingClassName) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={click}
        onBlur={() => setPending(false)}
        className={pending ? pendingClassName : className}
      >
        {pending ? pendingLabel : label}
      </button>
    );
  }

  return (
    <Button
      variant={pending ? pendingVariant : variant}
      size={size}
      className={className}
      icon={icon}
      disabled={disabled}
      onClick={click}
      onBlur={() => setPending(false)}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
