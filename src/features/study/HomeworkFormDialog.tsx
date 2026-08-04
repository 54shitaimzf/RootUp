import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/DialogFooter";
import { Field } from "../../components/Field";
import { InlineNotice } from "../../components/InlineNotice";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { FormSection } from "../../components/FormSection";
import { Select } from "../../components/Select";
import { TextArea } from "../../components/TextArea";
import { TimeSelect } from "../../components/TimeSelect";
import {
  DEMO_SEMESTER_START,
  minToTime,
  snapToFiveMinutes,
  suggestDueForCourse,
  type Course,
  type Homework,
  type HomeworkDraft,
} from "../../lib/study";

const NOTE_MAX = 200;
const DETAILS_MAX = 5000;

function toISODate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

export function HomeworkFormDialog({
  open,
  initial,
  courses,
  today,
  semesterStart = DEMO_SEMESTER_START,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: Homework | null;
  courses: Course[];
  today: Date;
  semesterStart?: string;
  onSave: (draft: HomeworkDraft) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("23:59");
  const [dueTouched, setDueTouched] = useState(false);
  const [suggestedCourse, setSuggestedCourse] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDueTouched(true);
    setSuggestedCourse(null);
    if (initial) {
      setTitle(initial.title);
      setCourseId(initial.courseId ?? "");
      setDueDate(initial.dueAt.slice(0, 10));
      setDueTime(initial.dueAt.slice(11, 16));
      setNote(initial.note);
      setDetails(initial.details);
    } else {
      const fallback = new Date(today);
      fallback.setDate(fallback.getDate() + 7);
      setTitle("");
      setCourseId("");
      setDueDate(toISODate(fallback));
      setDueTime(
        minToTime(snapToFiveMinutes(today.getHours() * 60 + today.getMinutes())),
      );
      setDueTouched(false);
      setNote("");
      setDetails("");
    }
  }, [open, initial, today]);

  const dueIso =
    dueDate && dueTime ? `${dueDate}T${dueTime}:00` : "";
  const duePast =
    dueIso !== "" &&
    (initial?.status ?? "pending") === "pending" &&
    new Date(dueIso).getTime() < today.getTime();

  const handleCourseChange = (value: string) => {
    setCourseId(value);
    if (dueTouched) return;
    const fallback = new Date(today);
    fallback.setDate(fallback.getDate() + 7);
    if (value === "") {
      setDueDate(toISODate(fallback));
      setDueTime(
        minToTime(
          snapToFiveMinutes(today.getHours() * 60 + today.getMinutes()),
        ),
      );
      setSuggestedCourse(null);
      return;
    }
    const course = courses.find((item) => item.id === value);
    if (!course) return;
    setDueDate(suggestDueForCourse(course, today, semesterStart));
    setDueTime("23:59");
    setSuggestedCourse(course.name);
  };

  const handleDueDateChange = (value: string) => {
    setDueDate(value);
    setDueTouched(true);
    setSuggestedCourse(null);
  };

  const handleDueTimeChange = (value: string) => {
    setDueTime(value);
    setDueTouched(true);
    setSuggestedCourse(null);
  };

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (
      !trimmedTitle ||
      trimmedTitle.length > 60 ||
      !dueDate ||
      !dueTime ||
      note.length > NOTE_MAX ||
      details.length > DETAILS_MAX
    ) {
      setError(t("study.homeworkFormInvalid"));
      return;
    }
    setError(null);
    onSave({
      courseId: courseId === "" ? null : courseId,
      title: trimmedTitle,
      note: note.trim(),
      details: details.trim(),
      dueAt: `${dueDate}T${dueTime}:00`,
      status: initial?.status ?? "pending",
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t(initial ? "study.editHomework" : "study.addHomework")}
      onClose={onClose}
      width="max-w-md"
      footer={
        <DialogFooter>
          <Button variant="primary" size="md" onClick={handleSave}>
            {t("settings.save")}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
        </DialogFooter>
      }
    >
      <div className="space-y-4">
        <FormSection title={t("study.sectionBasic")}>
          <div className="space-y-2.5">
            <Field label={t("study.homeworkTitle")} htmlFor="homework-title">
              <Input
                id="homework-title"
                size="sm"
                autoFocus
                value={title}
                maxLength={60}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("study.homeworkTitlePlaceholder")}
              />
            </Field>
            <Field
              label={t("study.courseOptional")}
              htmlFor="homework-course"
            >
              <Select
                id="homework-course"
                value={courseId}
                onChange={(event) => handleCourseChange(event.target.value)}
              >
                <option value="">{t("study.noCourse")}</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        <FormSection title={t("study.dueAt")}>
          <div className="flex items-end gap-2">
            <Field
              label={t("study.date")}
              htmlFor="homework-due-date"
              className="min-w-0 flex-1"
            >
              <Input
                id="homework-due-date"
                size="sm"
                type="date"
                value={dueDate}
                onChange={(event) => handleDueDateChange(event.target.value)}
              />
            </Field>
            <Field label={t("study.time")} htmlFor="homework-due-time">
              <TimeSelect
                id="homework-due-time"
                ariaLabel={t("study.time")}
                value={dueTime}
                onChange={handleDueTimeChange}
              />
            </Field>
          </div>
          {suggestedCourse && (
            <p className="mt-1.5 text-xs text-muted">
              {t("study.dueSuggested", { name: suggestedCourse })}
            </p>
          )}
          {duePast && (
            <InlineNotice variant="error" className="mt-2">
              {t("study.duePastWarning")}
            </InlineNotice>
          )}
        </FormSection>

        <FormSection title={t("study.sectionHomeworkDetails")}>
          <div className="space-y-2.5">
            <Field
              label={t("study.note")}
              hint={t("study.noteHint")}
              htmlFor="homework-note"
            >
              <Input
                id="homework-note"
                size="sm"
                value={note}
                maxLength={NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("study.notePlaceholder")}
              />
              <div className="mt-1 text-right text-[10px] text-muted">
                {t("study.noteCounter", { count: note.length })}
              </div>
            </Field>
            <Field
              label={t("study.details")}
              hint={t("study.detailsHint")}
              htmlFor="homework-details"
            >
              <TextArea
                id="homework-details"
                size="sm"
                value={details}
                maxLength={DETAILS_MAX}
                onChange={(event) => setDetails(event.target.value)}
                rows={5}
              />
              <div className="mt-1 text-right text-[10px] text-muted">
                {t("study.detailsCounter", { count: details.length })}
              </div>
            </Field>
          </div>
        </FormSection>

        {error && <InlineNotice variant="error">{error}</InlineNotice>}
      </div>
    </Modal>
  );
}
