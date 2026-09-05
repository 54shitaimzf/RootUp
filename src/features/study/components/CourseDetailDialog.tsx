import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Pencil, Trash2 } from "../../../theme/icons";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { DialogFooter } from "../../../components/DialogFooter";
import { Modal } from "../../../components/Modal";
import { LABEL_COLORS } from "../../../lib/labelDefs";
import { courseOverview, type CourseOverview } from "../../../lib/tauri";
import {
  formatClockRange,
  homeworkStatusTone,
  type Course,
  type Homework,
  type HomeworkStatusTone,
} from "../../../lib/study";
import { DueText } from "./DueText";

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const TONE_DOT: Record<HomeworkStatusTone, string> = {
  pending: "bg-brand-500",
  overdue: "bg-red-500",
  done: "bg-blue-500",
  archived: "bg-slate-400 dark:bg-slate-500",
};

export function CourseDetailDialog({
  open,
  course,
  homework,
  today,
  onEdit,
  onDelete,
  onSelectHomework,
  onClose,
}: {
  open: boolean;
  course: Course | null;
  homework: Homework[];
  today: Date;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onSelectHomework: (homeworkId: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "zh-CN";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overview, setOverview] = useState<CourseOverview | null>(null);
  useEffect(() => {
    if (!open || !course) {
      setOverview(null);
      return;
    }
    // 课程挂钩（0.8.7 阶段二）：相关文件/项目为只读查询，失败静默（不影响详情主体）
    courseOverview(course.id)
      .then(setOverview)
      .catch(() => setOverview(null));
  }, [open, course?.id]);
  if (!course) return null;

  const weekText =
    course.weekRule === "odd"
      ? t("study.weekRuleOdd")
      : course.weekRule === "even"
        ? t("study.weekRuleEven")
        : course.weekRule === "range"
          ? `${t("study.weekRuleRange")} ${course.weekRange ?? ""}`
          : t("study.weekRuleAll");

  const infoItems = [
    { label: t("study.teacher"), value: course.teacher || "—" },
    { label: t("study.location"), value: course.location || "—" },
    {
      label: t("study.day"),
      value: t(`study.${DAY_KEYS[course.day - 1]}`),
    },
    {
      label: t("study.startTime"),
      value: formatClockRange(course.startMin, course.endMin, lang),
    },
    { label: t("study.weekRule"), value: weekText },
  ];

  return (
    <>
      <Modal
        open={open}
        title={t("study.courseDetail")}
        onClose={onClose}
        width="max-w-lg"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Button
              variant="danger"
              size="md"
              icon={Trash2}
              onClick={() => setConfirmDelete(true)}
            >
              {t("study.deleteCourse")}
            </Button>
            <DialogFooter>
              <Button variant="primary" size="md" icon={Pencil} onClick={onEdit}>
                {t("settings.edit")}
              </Button>
              <Button variant="ghost" size="md" onClick={onClose}>
                {t("settings.dialogClose")}
              </Button>
            </DialogFooter>
          </div>
        }
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`size-3 shrink-0 rounded-full ${LABEL_COLORS[course.color].dot}`}
          />
          <h3 className="text-base font-semibold text-strong">{course.name}</h3>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {infoItems.map((item) => (
            <div key={item.label} title={item.value}>
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd className="mt-0.5 truncate text-sm text-secondary">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        {overview && (overview.files.length > 0 || overview.projects.length > 0) && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <h4 className="text-sm font-semibold text-secondary">
              {t("study.courseRelated")}
            </h4>
            {overview.projects.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted">{t("filter.project")}</p>
                <ul className="mt-1 space-y-1">
                  {overview.projects.slice(0, 5).map((project) => (
                    <li
                      key={project.id}
                      title={project.path}
                      className="truncate rounded-md bg-slate-50 px-3 py-1.5 text-xs text-secondary dark:bg-slate-800"
                    >
                      {project.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {overview.files.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted">{t("filter.file")}</p>
                <ul className="mt-1 space-y-1">
                  {overview.files.slice(0, 5).map((file) => (
                    <li
                      key={file.id}
                      title={file.path}
                      className="truncate rounded-md bg-slate-50 px-3 py-1.5 text-xs text-secondary dark:bg-slate-800"
                    >
                      {file.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h4 className="text-sm font-semibold text-secondary">
            {t("study.courseHomework")}
          </h4>
          {homework.length === 0 ? (
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-muted dark:bg-slate-800">
              {t("study.noCourseHomework")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {homework.map((item) => {
                const tone = homeworkStatusTone(item.status, item.dueAt, today);
                const done = item.status === "done";
                const archived = item.status === "archived";
                const statusLabel = archived
                  ? t("study.statusArchived")
                  : done
                    ? t("study.statusDone")
                    : tone === "overdue"
                      ? t("study.statusOverdue")
                      : t("study.statusPending");
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelectHomework(item.id)}
                      className="flex w-full items-center gap-2.5 rounded-md border border-slate-200 px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          done
                            ? "text-slate-400 line-through dark:text-slate-500"
                            : archived
                              ? "text-slate-400 dark:text-slate-500"
                              : "text-strong"
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted">
                        <DueText homework={item} today={today} />
                      </span>
                      <span className="shrink-0 rounded-xs bg-slate-100 px-1.5 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        {statusLabel}
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={t("study.deleteCourse")}
        description={t("study.deleteCourseConfirm", { name: course.name })}
        confirmLabel={t("study.deleteCourse")}
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(course.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
