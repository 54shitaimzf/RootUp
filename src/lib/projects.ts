/** 首选 IDE 选项（与后端 preferred_ide 白名单一致）。 */
export const PREFERRED_IDE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "auto", labelKey: "settings.preferredIdeAuto" },
  { value: "vscode", labelKey: "settings.preferredIdeVscode" },
  { value: "cursor", labelKey: "settings.preferredIdeCursor" },
  { value: "idea", labelKey: "settings.preferredIdeIdea" },
  { value: "pycharm", labelKey: "settings.preferredIdePycharm" },
  { value: "rustrover", labelKey: "settings.preferredIdeRustrover" },
  { value: "goland", labelKey: "settings.preferredIdeGoland" },
  { value: "none", labelKey: "settings.preferredIdeNone" },
];
