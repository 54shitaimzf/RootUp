import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { CustomOpenCommand, ProjectKind } from "../../lib/tauri";
import { PREFERRED_IDE_OPTIONS } from "../../lib/projects";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Modal } from "../../components/Modal";
import { SectionLabel } from "../../components/SectionLabel";
import { ProjectKindBadge } from "../../components/ProjectKindBadge";

const MAX_CUSTOM_COMMANDS = 10;
const KIND_ORDER: ProjectKind[] = [
  "rust",
  "node",
  "python",
  "java",
  "csharp",
  "go",
  "unity",
  "generic",
];

export interface OpenConfig {
  preferredIde: string;
  customOpenCommands: CustomOpenCommand[];
}

export function ProjectOpenDialog({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: OpenConfig;
  onSave: (draft: OpenConfig) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [preferredIde, setPreferredIde] = useState(initial.preferredIde);
  const [commands, setCommands] = useState<CustomOpenCommand[]>([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [tool, setTool] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPreferredIde(initial.preferredIde);
      setCommands(initial.customOpenCommands);
      setName("");
      setCommand("");
      setTool("");
      setError(null);
    }
  }, [open, initial]);

  const addCommand = () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (
      !trimmedName ||
      !trimmedCommand ||
      [...trimmedName].length > 40 ||
      [...trimmedCommand].length > 260
    ) {
      setError(t("settings.customCommandInvalid"));
      return;
    }
    if (commands.length >= MAX_CUSTOM_COMMANDS) {
      setError(t("settings.customCommandLimit"));
      return;
    }
    setCommands((prev) => [
      ...prev,
      { name: trimmedName, command: trimmedCommand, tool: tool.trim() },
    ]);
    setName("");
    setCommand("");
    setTool("");
    setError(null);
  };

  const removeCommand = (index: number) => {
    setCommands((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    try {
      await onSave({ preferredIde, customOpenCommands: commands });
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Modal
      open={open}
      title={t("settings.projectOpenDialogTitle")}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button variant="primary" size="md" onClick={() => void save()}>
            {t("settings.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}

        <div>
          <SectionLabel>{t("settings.preferredIde")}</SectionLabel>
          <select
            value={preferredIde}
            onChange={(event) => setPreferredIde(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          >
            {PREFERRED_IDE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <SectionLabel>{t("settings.customOpenCommands")}</SectionLabel>
          <p className="mt-1 text-xs text-muted">
            {t("settings.customOpenCommandsHint")}
          </p>
          <div className="mt-2 space-y-1">
            {commands.length === 0 ? (
              <p className="text-xs text-muted">—</p>
            ) : (
              commands.map((item, index) => (
                <div
                  key={`${item.name}-${index}`}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 dark:bg-slate-800"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-secondary">
                    {item.name}
                  </span>
                  <span className="hidden max-w-40 truncate font-mono text-[10px] text-muted sm:block">
                    {item.command}
                  </span>
                  <IconButton
                    label={t("projects.remove")}
                    icon={Trash2}
                    tone="danger"
                    size="sm"
                    onClick={() => removeCommand(index)}
                  />
                </div>
              ))
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settings.customCommandName")}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              type="text"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={t("settings.customCommandPath")}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={tool}
                onChange={(event) => setTool(event.target.value)}
                placeholder={t("settings.customCommandTool")}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={addCommand}
              >
                {t("settings.addCustomCommand")}
              </Button>
            </div>
          </div>
        </div>

        <div>
          <SectionLabel>{t("settings.openToolsHintTitle")}</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {KIND_ORDER.map((kind) => (
              <ProjectKindBadge key={kind} kind={kind} size="sm" />
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {t("settings.openToolsHint")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
