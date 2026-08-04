import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { DialogFooter } from "../../../components/DialogFooter";
import { Field } from "../../../components/Field";
import { IconButton } from "../../../components/IconButton";
import { InlineNotice } from "../../../components/InlineNotice";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import {
  defaultWeekCount,
  validateSemesterForm,
  type SemesterFormError,
  type SemesterFormInput,
} from "../../../lib/studyStore";
import type { Semester } from "../../../lib/study";

const ERROR_KEYS: Record<SemesterFormError, string> = {
  nameRequired: "study.semesterNameRequired",
  nameTooLong: "study.semesterNameTooLong",
  startRequired: "study.semesterStartRequired",
  endBeforeStart: "study.semesterEndBeforeStart",
  weekCountInvalid: "study.semesterWeeksInvalid",
  duplicateName: "study.semesterDuplicateName",
};

const EMPTY_FORM: SemesterFormInput = {
  name: "",
  startDate: "",
  endDate: "",
  weekCount: "",
};

export function SemesterManageDialog({
  open,
  semesters,
  courseCounts,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  semesters: Semester[];
  courseCounts: Record<string, number>;
  onSave: (
    input: {
      name: string;
      startDate: string;
      endDate?: string;
      weekCount: number;
    },
    editingId?: string,
    copyFromId?: string,
  ) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copyFromId, setCopyFromId] = useState<string | null>(null);
  const [form, setForm] = useState<SemesterFormInput>(EMPTY_FORM);
  const [error, setError] = useState<SemesterFormError | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Semester | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormOpen(false);
    setEditingId(null);
    setCopyFromId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDeleteTarget(null);
  }, [open]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setCopyFromId(null);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (semester: Semester) => {
    setForm({
      name: semester.name,
      startDate: semester.startDate,
      endDate: semester.endDate ?? "",
      weekCount: String(semester.weekCount),
    });
    setEditingId(semester.id);
    setCopyFromId(null);
    setError(null);
    setFormOpen(true);
  };

  const openCopy = (semester: Semester) => {
    setForm({
      name: `${semester.name}${t("study.copySuffix")}`,
      startDate: semester.startDate,
      endDate: semester.endDate ?? "",
      weekCount: String(semester.weekCount),
    });
    setEditingId(null);
    setCopyFromId(semester.id);
    setError(null);
    setFormOpen(true);
  };

  const handleSave = () => {
    const result = validateSemesterForm(
      form,
      semesters,
      editingId ?? undefined,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSave(
      {
        name: result.name,
        startDate: result.startDate,
        endDate: result.endDate,
        weekCount: result.weekCount,
      },
      editingId ?? undefined,
      copyFromId ?? undefined,
    );
    setFormOpen(false);
    setEditingId(null);
    setCopyFromId(null);
    setError(null);
    onClose();
  };

  const autoWeeks =
    form.startDate && form.endDate
      ? defaultWeekCount(form.startDate, form.endDate)
      : null;
  const nameInvalid =
    error === "nameRequired" ||
    error === "nameTooLong" ||
    error === "duplicateName";
  const startInvalid = error === "startRequired";
  const endInvalid = error === "endBeforeStart";
  const weeksInvalid = error === "weekCountInvalid";

  return (
    <>
      <Modal
        open={open}
        title={
          formOpen
            ? t(editingId ? "study.editSemester" : "study.newSemester")
            : t("study.manageSemesters")
        }
        onClose={onClose}
        width="max-w-lg"
        footer={
          formOpen ? (
            <DialogFooter>
              <Button variant="primary" size="md" onClick={handleSave}>
                {t("settings.save")}
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setFormOpen(false);
                  setError(null);
                }}
              >
                {t("settings.cancel")}
              </Button>
            </DialogFooter>
          ) : undefined
        }
      >
        {formOpen ? (
          <div className="space-y-3">
            {error && (
              <InlineNotice variant="error">{t(ERROR_KEYS[error])}</InlineNotice>
            )}
            <Field label={t("study.semesterName")} htmlFor="semester-name">
              <Input
                id="semester-name"
                size="sm"
                invalid={nameInvalid}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder={t("study.semesterNamePlaceholder")}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("study.semesterStart")} htmlFor="semester-start">
                <Input
                  id="semester-start"
                  size="sm"
                  type="date"
                  invalid={startInvalid}
                  value={form.startDate}
                  onChange={(event) =>
                    setForm({ ...form, startDate: event.target.value })
                  }
                />
              </Field>
              <Field label={t("study.semesterEnd")} htmlFor="semester-end">
                <Input
                  id="semester-end"
                  size="sm"
                  type="date"
                  invalid={endInvalid}
                  value={form.endDate}
                  onChange={(event) =>
                    setForm({ ...form, endDate: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field
              label={t("study.semesterWeeks")}
              htmlFor="semester-weeks"
              hint={
                autoWeeks !== null
                  ? t("study.weeksAutoHint", { count: autoWeeks })
                  : undefined
              }
            >
              <Input
                id="semester-weeks"
                size="sm"
                type="number"
                min={1}
                max={30}
                invalid={weeksInvalid}
                value={form.weekCount}
                onChange={(event) =>
                  setForm({ ...form, weekCount: event.target.value })
                }
              />
            </Field>
          </div>
        ) : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              className="w-full justify-center"
              onClick={openNew}
            >
              {t("study.newSemester")}
            </Button>
            <ul className="mt-3 space-y-2">
              {semesters.map((semester) => (
                <li
                  key={semester.id}
                  className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-strong">
                      {semester.name}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted">
                      {semester.startDate} ~ {semester.endDate ?? "—"} ·{" "}
                      {t("study.weekCount", { count: semester.weekCount })} ·{" "}
                      {t("study.courseCount", {
                        count: courseCounts[semester.id] ?? 0,
                      })}
                    </div>
                  </div>
                  <IconButton
                    label={t("study.editSemester")}
                    icon={Pencil}
                    size="sm"
                    tone="neutral"
                    onClick={() => openEdit(semester)}
                  />
                  <IconButton
                    label={t("study.copySemester")}
                    icon={Copy}
                    size="sm"
                    tone="neutral"
                    onClick={() => openCopy(semester)}
                  />
                  <IconButton
                    label={t("study.deleteSemester")}
                    icon={Trash2}
                    size="sm"
                    tone="danger"
                    onClick={() => setDeleteTarget(semester)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("study.deleteSemester")}
        description={t("study.deleteSemesterConfirm", {
          name: deleteTarget?.name ?? "",
        })}
        confirmLabel={t("study.deleteSemester")}
        danger
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
