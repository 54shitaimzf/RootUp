import { useTranslation } from "react-i18next";
import {
  calendarDaysUntil,
  isOverdue,
  overdueDays,
  type Homework,
} from "../../../lib/study";

/** 统一截止文案：逾期 N 天 / 今天 / 明天 / N 天后 / 已完成绝对时间。 */
export function DueText({
  homework,
  today,
}: {
  homework: Homework;
  today: Date;
}) {
  const { t } = useTranslation();
  const absolute = homework.dueAt.slice(0, 16).replace("T", " ");
  if (homework.status !== "pending") return <>{absolute}</>;
  if (isOverdue(homework, today)) {
    return (
      <span className="font-medium text-red-500">
        {t("study.overdueDays", { days: overdueDays(homework.dueAt, today) })} ·{" "}
        {absolute}
      </span>
    );
  }
  const days = calendarDaysUntil(homework.dueAt, today);
  if (days === 0) return <>{t("study.dueToday")} · {absolute}</>;
  if (days === 1) return <>{t("study.dueTomorrow")} · {absolute}</>;
  return <>{t("study.daysLeft", { days })} · {absolute}</>;
}
