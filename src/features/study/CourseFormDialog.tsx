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
import { SectionLabel } from "../../components/SectionLabel";
import { Select } from "../../components/Select";
import type { LabelColorKey } from "../../lib/labelDefs";
import {
  autoAssignCourseColor,
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
  existingColors = [],
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  initial: Course | null;
  existingColors?: LabelColorKey[];
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
        width="max-w-md"
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
        <div className="space-y-5">
          {error && <InlineNotice variant="error">{error}</InlineNotice>}
          <section>
            <SectionLabel>{t("study.sectionBasic")}</SectionLabel>
            <div className="mt-3 space-y-3">
              <Field label={t("study.courseName")} htmlFor="course-name">
                <Input
                  id="course-name"
                  size="sm"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder={t("study.courseNamePlaceholder")}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("study.teacher")} htmlFor="course-teacher">
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
            </div>
          </section>

          <section>
            <SectionLabel>{t("study.sectionTimeWeeks")}</SectionLabel>
            <div className="mt-3 grid grid-cols-3 gap-3">
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
              <Field label={t("study.startTime")} htmlFor="course-start">
                <Input
                  id="course-start"
                  size="sm"
                  type="time"
                  value={form.startTime}
                  onChange={(event) =>
                    setForm({ ...form, startTime: event.target.value })
                  }
                />
              </Field>
              <Field label={t("study.endTime")} htmlFor="course-end">
                <Input
                  id="course-end"
                  size="sm"
                  type="time"
                  value={form.endTime}
                  onChange={(event) =>
                    setForm({ ...form, endTime: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
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
              <Field
                label={t("study.weekRangePlaceholder")}
                hint={t("study.weekRangeHint")}
                htmlFor="course-week-range"
              >
                <Input
                  id="course-week-range"
                  size="sm"
                  value={form.weekRange}
                  disabled={form.weekRule !== "range"}
                  onChange={(event) =>
                    setForm({ ...form, weekRange: event.target.value })
                  }
                  placeholder={t("study.weekRangePlaceholder")}
                />
              </Field>
            </div>
          </section>

          <section>
            <SectionLabel>{t("study.sectionColor")}</SectionLabel>
            <div className="mt-3">
              <ColorPicker
                allowAuto
                autoLabel={t("study.colorAuto")}
                value={form.color}
                onChange={(color) => setForm({ ...form, color })}
              />
            </div>
          </section>
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
