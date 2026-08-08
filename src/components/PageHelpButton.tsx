import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./IconButton";
import { useHelpCenter } from "./HelpCenter";

/**
 * 页面级帮助入口：打开帮助中心并直达指定文章或分区。
 * 仅作入口，不含任何帮助内容（内容在 lib/helpContent 注册表）。
 */
export function PageHelpButton({ target }: { target: string }) {
  const { t } = useTranslation();
  const { openHelp } = useHelpCenter();
  return (
    <IconButton
      label={t("help.pageHelp")}
      icon={HelpCircle}
      tone="neutral"
      size="md"
      onClick={() => openHelp(target)}
    />
  );
}
