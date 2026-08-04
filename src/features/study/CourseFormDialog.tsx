import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { ColorPicker } from "../../components/ColorPicker";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DialogFooter } from "../../components/DialogFooter";
import { Field } from "../../components/Field";
import { InlineNotice } from "../../components/InlineNotice";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { FormSection } from "../../components/FormSection";
import { Select } from "../../components/Select";
import { TimeRangeField } from "../../components/TimeRangeField";
import type { LabelColorKey } from "../../lib/labelDefs";
import {
  COURSE_DURATION_PRESETS,
  DEFAULT_COURSE_DURATION,
  autoAssignCourseColor,
  clampCourseEnd,
  courseConflicts,
  isValidWeekRange,
  minToTime,
  normalizeWeekRange,
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
  color: LabelColorKey | "auto";
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
  color: "auto",
};

export function CourseFormDialog({
  open,
  initial,
  existingCourses = [],
  existingColors = [],
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  initial: Course | null;
  existingCourses?: Course[];
  existingColors?: LabelColorKey[];
  onSave: (draft: CourseDraft) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [autoAdjusted, setAutoAdjusted] = useState(false);
  const [timeInvalid, setTimeInvalid] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [weekRangeInvalid, setWeekRangeInvalid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmDelete(false);
    setAutoAdjusted(false);
    setTimeInvalid(false);
    setNameInvalid(false);
    setWeekRangeInvalid(false);
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

  const startMin = timeToMin(form.startTime);
  const endMin = timeToMin(form.endTime);
  const normalizedWeekRange = normalizeWeekRange(form.weekRange);
  const duration =
    startMin !== null && endMin !== null ? endMin - startMin : 0;
  const conflicts = courseConflicts(
    {
      day: Number(form.day),
      startMin: startMin ?? 0,
      endMin: endMin ?? 0,
      weekRule: form.weekRule,
      weekRange: normalizedWeekRange,
    },
    existingCourses,
    initial?.id,
  );

  const handleStartChange = (value: string) => {
    const start = timeToMin(value);
    const end = timeToMin(form.endTime);
    if (start !== null && end !== null && end <= start) {
      const adjusted = clampCourseEnd(start, DEFAULT_COURSE_DURATION);
      setForm((prev) => ({
        ...prev,
        startTime: value,
        endTime: minToTime(adjusted),
      }));
      setAutoAdjusted(true);
      setTimeInvalid(false);
    } else {
      setForm((prev) => ({ ...prev, startTime: value }));
      setAutoAdjusted(false);
    }
  };

  const handleEndChange = (value: string) => {
    const start = timeToMin(form.startTime);
    const end = timeToMin(value);
    setForm((prev) => ({ ...prev, endTime: value }));
    setTimeInvalid(start !== null && end !== null && end <= start);
    if (start !== null && end !== null && end > start) {
      setAutoAdjusted(false);
    }
  };

  const applyDuration = (minutes: number) => {
    const start = timeToMin(form.startTime) ?? 480;
    setForm((prev) => ({
      ...prev,
      endTime: minToTime(clampCourseEnd(start, minutes)),
    }));
    setTimeInvalid(false);
    setAutoAdjusted(false);
  };

  const handleSave = () => {
    const name = form.name.trim();
    const start = timeToMin(form.startTime);
    const end = timeToMin(form.endTime);
    const day = Number(form.day);
    const rangeValid =
      form.weekRule !== "range" || isValidWeekRange(normalizedWeekRange);
    let invalid = false;

    if (!name || name.length > 40) {
      setNameInvalid(true);
      invalid = true;
    } else {
      setNameInvalid(false);
    }
    if (
      form.teacher.trim().length > 40 ||
      form.location.trim().length > 40 ||
      start === null ||
      end === null ||
      end <= start ||
      Number.isNaN(day) ||
      day < 1 ||
      day > 7
    ) {
      if (start !== null && end !== null && end <= start) setTimeInvalid(true);
      invalid = true;
    } else {
      setTimeInvalid(false);
    }
    setWeekRangeInvalid(!rangeValid);
    if (!rangeValid) invalid = true;

    if (invalid) {
      setError(t("study.formInvalid"));
      return;
    }
    setError(null);
    onSave({
      name,
      teacher: form.teacher.trim(),
      location: form.location.trim(),
      day,
      startMin: start as number,
      endMin: end as number,
      weekRule: form.weekRule,
      weekRange: form.weekRule === "range" ? normalizedWeekRange : undefined,
      color:
        form.color === "auto"
          ? autoAssignCourseColor(existingColors)
          : form.color,
    });
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        title={t(initial ? "study.editCourse" : "study.addCourse")}
        onClose={onClose}
        width="max-w-lg"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {initial && onDelete && (
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("study.deleteCourse")}
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button variant="primary" size="md" onClick={handleSave}>
                {t("settings.save")}
              </Button>
              <Button variant="ghost" size="md" onClick={onClose}>
                {t("settings.cancel")}
              </Button>
            </DialogFooter>
          </div>
        }
      >
        <div className="space-y-4">
          <FormSection title={t("study.sectionBasic")}>
            <div className="space-y-2.5">
              <div className="grid grid-cols-7 gap-2">
                <Field
                  label={t("study.courseName")}
                  htmlFor="course-name"
                  className="col-span-5"
                >
                  <Input
                    id="course-name"
                    size="sm"
                    autoFocus
                    invalid={nameInvalid}
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    placeholder={t("study.courseNamePlaceholder")}
                  />
                </Field>
                <Field
                  label={t("study.teacher")}
                  htmlFor="course-teacher"
                  className="col-span-2"
                >
                  <Input
                    id="course-teacher"
                    size="sm"
                    value={form.teacher}
                    onChange={(event) =>
                      setForm({ ...form, teacher: event.target.value })
                    }
                    placeholder={t("study.teacherPlaceholder")}
                  />
                </Field>
              </div>
              <Field label={t("study.location")} htmlFor="course-location">
                <Input
                  id="course-location"
                  size="sm"
                  value={form.location}
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                  placeholder={t("study.locationPlaceholder")}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title={t("study.sectionTimeWeeks")}>
            <div className="space-y-2.5">
              <Field label={t("study.day")} htmlFor="course-day">
                <Select
                  id="course-day"
                  value={form.day}
                  onChange={(event) =>
                    setForm({ ...form, day: event.target.value })
                  }
                >
                  {DAY_KEYS.map((key, index) => (
                    <option key={key} value={String(index + 1)}>
                      {t(`study.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <TimeRangeField
                  startLabel={t("study.startTime")}
                  endLabel={t("study.endTime")}
                  connector={t("study.timeTo")}
                  startId="course-start"
                  endId="course-end"
                  startValue={form.startTime}
                  endValue={form.endTime}
                  onStartChange={handleStartChange}
                  onEndChange={handleEndChange}
                  endInvalid={timeInvalid}
                />
                {timeInvalid && (
                  <p className="mt-1 text-xs text-red-500">
                    {t("study.timeOrderError")}
                  </p>
                )}
                {autoAdjusted && (
                  <InlineNotice variant="info" className="mt-2">
                    {t("study.autoAdjustedTime")}
                  </InlineNotice>
                )}
              </div>
              <div>
                <span className="text-xs font-medium text-secondary">
                  {t("study.durationPreset")}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {COURSE_DURATION_PRESETS.map((minutes) => {
                    const active = duration === minutes;
                    return (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => applyDuration(minutes)}
                        className={`rounded-xs px-2 py-1 text-[10px] font-medium transition-colors ${
                          active
                            ? "bg-brand-700 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300"
                        }`}
                      >
                        {t("study.durationMinutes", { count: minutes })}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label={t("study.weekRule")} htmlFor="course-week-rule">
                <Select
                  id="course-week-rule"
                  value={form.weekRule}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      weekRule: event.target.value as WeekRule,
                    })
                  }
                >
                  <option value="all">{t("study.weekRuleAll")}</option>
                  <option value="odd">{t("study.weekRuleOdd")}</option>
                  <option value="even">{t("study.weekRuleEven")}</option>
                  <option value="range">{t("study.weekRuleRange")}</option>
                </Select>
              </Field>
              {form.weekRule === "range" && (
                <Field
                  label={t("study.weekRuleRange")}
                  htmlFor="course-week-range"
                >
                  <Input
                    id="course-week-range"
                    size="sm"
                    invalid={weekRangeInvalid}
                    value={form.weekRange}
                    onChange={(event) =>
                      setForm({ ...form, weekRange: event.target.value })
                    }
                    onBlur={() =>
                      setForm((prev) => ({
                        ...prev,
                        weekRange: normalizeWeekRange(prev.weekRange),
                      }))
                    }
                    placeholder={t("study.weekRangePlaceholder")}
                  />
                  {weekRangeInvalid && (
                    <p className="mt-1 text-xs text-red-500">
                      {t("study.weekRangeInvalid")}
                    </p>
                  )}
                </Field>
              )}
              {conflicts.length > 0 && (
                <InlineNotice variant="error">
                  {t("study.conflictWarning", {
                    names: conflicts.map((course) => course.name).join("、"),
                  })}
                </InlineNotice>
              )}
            </div>
          </FormSection>

          <FormSection title={t("study.sectionColor")}>
            <ColorPicker
              allowAuto
              autoLabel={t("study.colorAuto")}
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
          </FormSection>

          {error && <InlineNotice variant="error">{error}</InlineNotice>}
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
