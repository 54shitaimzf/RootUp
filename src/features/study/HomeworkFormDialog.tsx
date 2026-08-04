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
import type { Course, Homework, HomeworkDraft } from "../../lib/study";

const NOTE_MAX = 200;
const DETAILS_MAX = 5000;

function toLocalDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function HomeworkFormDialog({
  open,
  initial,
  courses,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: Homework | null;
  courses: Course[];
  onSave: (draft: HomeworkDraft) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setTitle(initial.title);
      setCourseId(initial.courseId ?? "");
      setDueAt(initial.dueAt.slice(0, 16));
      setNote(initial.note);
      setDetails(initial.details);
    } else {
      setTitle("");
      setCourseId("");
      setDueAt(toLocalDateTimeInput(new Date(Date.now() + 7 * 86_400_000)));
      setNote("");
      setDetails("");
    }
  }, [open, initial]);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (
      !trimmedTitle ||
      trimmedTitle.length > 60 ||
      !dueAt ||
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
      dueAt: `${dueAt}:00`,
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
      {error && (
        <InlineNotice variant="error" className="mb-4">
          {error}
        </InlineNotice>
      )}
      <div className="space-y-4">
        <FormSection title={t("study.sectionBasic")}>
          <div className="space-y-2.5">
            <Field label={t("study.homeworkTitle")} htmlFor="homework-title">
              <Input
                id="homework-title"
                size="sm"
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
                onChange={(event) => setCourseId(event.target.value)}
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
          <Input
            id="homework-due"
            size="sm"
            type="datetime-local"
            aria-label={t("study.dueAt")}
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
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
      </div>
    </Modal>
  );
}
