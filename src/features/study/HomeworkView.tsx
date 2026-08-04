import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { LABEL_COLORS } from "../../lib/labelDefs";
import {
  filterHomework,
  type Course,
  type Homework,
  type HomeworkStatusFilter,
} from "../../lib/study";
import { DueText } from "./DueText";

const STATUS_FILTERS: { value: HomeworkStatusFilter; labelKey: string }[] = [
  { value: "all", labelKey: "study.statusAll" },
  { value: "pending", labelKey: "study.statusPending" },
  { value: "done", labelKey: "study.statusDone" },
  { value: "archived", labelKey: "study.statusArchived" },
];

export function HomeworkView({
  homework,
  courses,
  courseFilter,
  onCourseFilterChange,
  today,
  expandHomeworkId = null,
  onAdd,
  onEdit,
  onToggleStatus,
  onArchive,
  onDelete,
}: {
  homework: Homework[];
  courses: Course[];
  courseFilter: "all" | "none" | string;
  onCourseFilterChange: (value: "all" | "none" | string) => void;
  today: Date;
  expandHomeworkId?: string | null;
  onAdd: () => void;
  onEdit: (item: Homework) => void;
  onToggleStatus: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] =
    useState<HomeworkStatusFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<Homework | null>(null);
  const [doneTarget, setDoneTarget] = useState<Homework | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!expandHomeworkId) return;
    setExpandedIds((prev) => {
      if (prev.has(expandHomeworkId)) return prev;
      const next = new Set(prev);
      next.add(expandHomeworkId);
      return next;
    });
  }, [expandHomeworkId]);

  const items = filterHomework(homework, {
    status: statusFilter,
    courseId: courseFilter,
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const courseChip = (item: Homework) => {
    const course = courses.find((c) => c.id === item.courseId);
    if (!course) {
      return <span className="text-muted">{t("study.noCourse")}</span>;
    }
    return (
      <span className="inline-flex items-center gap-1">
        <span
          className={`size-2 rounded-full ${LABEL_COLORS[course.color].dot}`}
        />
        {course.name}
      </span>
    );
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-secondary">
            {t("study.filterStatus")}
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map(({ value, labelKey }) => (
              <Chip
                key={value}
                size="md"
                variant={statusFilter === value ? "active" : "selectable"}
                onClick={() => setStatusFilter(value)}
              >
                {t(labelKey)}
              </Chip>
            ))}
          </div>
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
          {t("study.addHomework")}
        </Button>
      </div>

      <div className="mt-4">
        <span className="text-xs font-medium text-secondary">
          {t("study.filterCourse")}
        </span>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip
            size="md"
            variant={courseFilter === "all" ? "active" : "selectable"}
            onClick={() => onCourseFilterChange("all")}
          >
            {t("study.allCourses")}
          </Chip>
          <Chip
            size="md"
            variant={courseFilter === "none" ? "active" : "selectable"}
            onClick={() => onCourseFilterChange("none")}
          >
            {t("study.noCourse")}
          </Chip>
          {courses.map((course) => (
            <Chip
              key={course.id}
              size="md"
              variant={courseFilter === course.id ? "active" : "selectable"}
              icon={
                <span
                  className={`size-2 rounded-full ${LABEL_COLORS[course.color].dot}`}
                />
              }
              onClick={() => onCourseFilterChange(course.id)}
            >
              {course.name}
            </Chip>
          ))}
        </div>
      </div>

      {homework.length === 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title={t("study.homeworkEmpty")}
            description={t("study.homeworkEmptyDesc")}
            action={
              <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
                {t("study.addHomework")}
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <EmptyState title={t("study.noMatchingHomework")} />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => {
            const done = item.status === "done";
            const archived = item.status === "archived";
            const expanded = expandedIds.has(item.id);
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card dark:border-slate-800 dark:bg-slate-900"
              >
                <input
                  type="checkbox"
                  checked={done || archived}
                  disabled={archived}
                  onChange={() => {
                    if (item.status === "pending") {
                      setDoneTarget(item);
                    } else {
                      onToggleStatus(item.id);
                    }
                  }}
                  aria-label={item.title}
                  className="size-4 shrink-0 accent-brand-600"
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm font-medium ${
                      done || archived
                        ? "text-slate-400 line-through dark:text-slate-500"
                        : "text-strong"
                    }`}
                  >
                    {item.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                    <span>{courseChip(item)}</span>
                    <span>·</span>
                    <span>
                      <DueText homework={item} today={today} />
                    </span>
                    {item.note && (
                      <>
                        <span>·</span>
                        <span className="max-w-48 truncate">{item.note}</span>
                      </>
                    )}
                  </div>
                  {expanded && item.details && (
                    <div className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-secondary dark:bg-slate-800">
                      {item.details}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.details && (
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={expanded ? ChevronUp : ChevronDown}
                      onClick={() => toggleExpanded(item.id)}
                    >
                      {expanded
                        ? t("study.hideDetails")
                        : t("study.showDetails")}
                    </Button>
                  )}
                  {item.status === "done" && (
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={Archive}
                      onClick={() => onArchive(item.id)}
                    >
                      {t("study.archive")}
                    </Button>
                  )}
                  <IconButton
                    label={t("settings.edit")}
                    icon={Pencil}
                    tone="neutral"
                    size="sm"
                    onClick={() => onEdit(item)}
                  />
                  <IconButton
                    label={t("study.deleteHomework")}
                    icon={Trash2}
                    tone="danger"
                    size="sm"
                    onClick={() => setDeleteTarget(item)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={doneTarget !== null}
        title={t("study.markDone")}
        description={t("study.markDoneConfirm", {
          title: doneTarget?.title ?? "",
        })}
        confirmLabel={t("study.markDone")}
        onConfirm={() => {
          if (doneTarget) onToggleStatus(doneTarget.id);
          setDoneTarget(null);
        }}
        onCancel={() => setDoneTarget(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("study.deleteHomework")}
        description={t("study.deleteHomeworkConfirm", {
          title: deleteTarget?.title ?? "",
        })}
        confirmLabel={t("study.deleteHomework")}
        danger
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
