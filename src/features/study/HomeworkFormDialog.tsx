import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { InlineNotice } from "../../components/InlineNotice";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import type { Course, Homework, HomeworkDraft } from "../../lib/study";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setTitle(initial.title);
      setCourseId(initial.courseId ?? "");
      setDueAt(initial.dueAt.slice(0, 16));
      setNote(initial.note);
    } else {
      setTitle("");
      setCourseId("");
      setDueAt(toLocalDateTimeInput(new Date(Date.now() + 7 * 86_400_000)));
      setNote("");
    }
  }, [open, initial]);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (
      !trimmedTitle ||
      trimmedTitle.length > 60 ||
      !dueAt ||
      note.length > 200
    ) {
      setError(t("study.homeworkFormInvalid"));
      return;
    }
    setError(null);
    onSave({
      courseId: courseId === "" ? null : courseId,
      title: trimmedTitle,
      note: note.trim(),
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
        <div className="flex gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={handleSave}>
            {t("settings.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <InlineNotice variant="error">{error}</InlineNotice>}
        <label className="block">
          <span className="text-xs font-medium text-secondary">
            {t("study.homeworkTitle")}
          </span>
          <Input
            size="sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("study.homeworkTitlePlaceholder")}
            className="mt-1"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-secondary">
              {t("study.courseOptional")}
            </span>
            <Select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="mt-1"
            >
              <option value="">{t("study.noCourse")}</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-secondary">
              {t("study.dueAt")}
            </span>
            <Input
              size="sm"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="mt-1"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-secondary">
            {t("study.note")}
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("study.notePlaceholder")}
            rows={2}
            className="mt-1 min-w-0 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
      </div>
    </Modal>
  );
}
