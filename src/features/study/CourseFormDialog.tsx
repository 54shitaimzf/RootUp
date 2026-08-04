import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { InlineNotice } from "../../components/InlineNotice";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_KEYS,
  LABEL_COLORS,
  type LabelColorKey,
} from "../../lib/labelDefs";
import {
  isValidWeekRange,
  minToTime,
  timeToMin,
  type Course,
  type CourseDraft,
  type WeekRule,
} from "../../lib/study";

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

interface FormState {
  name: string;
  teacher: string;
  location: string;
  day: string;
  startTime: string;
  endTime: string;
  weekRule: WeekRule;
  weekRange: string;
  color: LabelColorKey;
}

const EMPTY_FORM: FormState = {
  name: "",
  teacher: "",
  location: "",
  day: "1",
  startTime: "08:00",
  endTime: "09:40",
  weekRule: "all",
  weekRange: "",
  color: DEFAULT_LABEL_COLOR,
};

export function CourseFormDialog({
  open,
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  initial: Course | null;
  onSave: (draft: CourseDraft) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmDelete(false);
    if (initial) {
      setForm({
        name: initial.name,
        teacher: initial.teacher,
        location: initial.location,
        day: String(initial.day),
        startTime: minToTime(initial.startMin),
        endTime: minToTime(initial.endMin),
        weekRule: initial.weekRule,
        weekRange: initial.weekRange ?? "",
        color: initial.color,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, initial]);

  const handleSave = () => {
    const name = form.name.trim();
    const start = timeToMin(form.startTime);
    const end = timeToMin(form.endTime);
    const day = Number(form.day);
    if (
      !name ||
      name.length > 40 ||
      form.teacher.trim().length > 40 ||
      form.location.trim().length > 40 ||
      start === null ||
      end === null ||
      end <= start ||
      Number.isNaN(day) ||
      day < 1 ||
      day > 7 ||
      (form.weekRule === "range" && !isValidWeekRange(form.weekRange))
    ) {
      setError(t("study.formInvalid"));
      return;
    }
    setError(null);
    onSave({
      name,
      teacher: form.teacher.trim(),
      location: form.location.trim(),
      day,
      startMin: start,
      endMin: end,
      weekRule: form.weekRule,
      weekRange:
        form.weekRule === "range" ? form.weekRange.trim() : undefined,
      color: form.color,
    });
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        title={t(initial ? "study.editCourse" : "study.addCourse")}
        onClose={onClose}
        width="max-w-md"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {initial && onDelete ? (
              <Button
                variant="danger"
                size="md"
                onClick={() => setConfirmDelete(true)}
              >
                {t("study.deleteCourse")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" size="md" onClick={onClose}>
                {t("settings.cancel")}
              </Button>
              <Button variant="primary" size="md" onClick={handleSave}>
                {t("settings.save")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <InlineNotice variant="error">{error}</InlineNotice>}
          <label className="block">
            <span className="text-xs font-medium text-secondary">
              {t("study.courseName")}
            </span>
            <Input
              size="sm"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={t("study.courseNamePlaceholder")}
              className="mt-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                {t("study.teacher")}
              </span>
              <Input
                size="sm"
                value={form.teacher}
                onChange={(event) =>
                  setForm({ ...form, teacher: event.target.value })
                }
                placeholder={t("study.teacherPlaceholder")}
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                {t("study.location")}
              </span>
              <Input
                size="sm"
                value={form.location}
                onChange={(event) =>
                  setForm({ ...form, location: event.target.value })
                }
                placeholder={t("study.locationPlaceholder")}
                className="mt-1"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                {t("study.day")}
              </span>
              <Select
                value={form.day}
                onChange={(event) => setForm({ ...form, day: event.target.value })}
                className="mt-1"
              >
                {DAY_KEYS.map((key, index) => (
                  <option key={key} value={String(index + 1)}>
                    {t(`study.${key}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                {t("study.startTime")}
              </span>
              <Input
                size="sm"
                type="time"
                value={form.startTime}
                onChange={(event) =>
                  setForm({ ...form, startTime: event.target.value })
                }
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                {t("study.endTime")}
              </span>
              <Input
                size="sm"
                type="time"
                value={form.endTime}
                onChange={(event) =>
                  setForm({ ...form, endTime: event.target.value })
                }
                className="mt-1"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-secondary">
                {t("study.weekRule")}
              </span>
              <Select
                value={form.weekRule}
                onChange={(event) =>
                  setForm({
                    ...form,
                    weekRule: event.target.value as WeekRule,
                  })
                }
                className="mt-1"
              >
                <option value="all">{t("study.weekRuleAll")}</option>
                <option value="odd">{t("study.weekRuleOdd")}</option>
                <option value="even">{t("study.weekRuleEven")}</option>
                <option value="range">{t("study.weekRuleRange")}</option>
              </Select>
            </label>
            {form.weekRule === "range" && (
              <label className="block">
                <span className="text-xs font-medium text-secondary">
                  {t("study.weekRangePlaceholder")}
                </span>
                <Input
                  size="sm"
                  value={form.weekRange}
                  onChange={(event) =>
                    setForm({ ...form, weekRange: event.target.value })
                  }
                  placeholder={t("study.weekRangePlaceholder")}
                  className="mt-1"
                />
              </label>
            )}
          </div>
          <div>
            <span className="text-xs font-medium text-secondary">
              {t("study.color")}
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {LABEL_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={form.color === key}
                  onClick={() => setForm({ ...form, color: key })}
                  className={`h-6 w-6 rounded-full ${LABEL_COLORS[key].dot} transition-transform ${
                    form.color === key
                      ? "ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-900"
                      : "hover:scale-110"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
      {initial && onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          title={t("study.deleteCourse")}
          description={t("study.deleteCourseConfirm", { name: initial.name })}
          confirmLabel={t("study.deleteCourse")}
          danger
          onConfirm={() => {
            onDelete(initial.id);
            setConfirmDelete(false);
            onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
