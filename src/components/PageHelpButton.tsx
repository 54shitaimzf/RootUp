import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { useHelpCenter } from "./HelpCenter";

/**
 * 页面级帮助入口：打开帮助中心并直达指定文章或分区。
 * 采用“Info 图标 + 文字”的帮助按钮，与搜索框内的“?”语法帮助在视觉上区分，
 * 避免同页出现两个问号图标；语义也不同（本页指南 vs 搜索语法）。
 * 仅作入口，不含任何帮助内容（内容在 lib/helpContent 注册表）。
 */
export function PageHelpButton({ target }: { target: string }) {
  const { t } = useTranslation();
  const { openHelp } = useHelpCenter();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Info}
      title={t("help.pageHelp")}
      onClick={() => openHelp(target)}
    >
      {t("help.pageHelpButton")}
    </Button>
  );
}
