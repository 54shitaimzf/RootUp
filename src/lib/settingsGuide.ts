/**
 * 设置说明单一数据源：设置行说明弹窗与说明中心“设置说明”分区共用，
 * 文案一律走 i18n key（中英成对），禁止两处各自维护。
 */
export type SettingsGuideGroup =
  | "general"
  | "watch"
  | "archive"
  | "reminder"
  | "advanced";

export interface SettingsGuideGroupDef {
  id: SettingsGuideGroup;
  titleKey: string;
  descriptionKey: string;
}

export interface SettingsGuideEntry {
  /** 稳定 id，同时作为设置行定位标识 */
  id: string;
  group: SettingsGuideGroup;
  titleKey: string;
  introKey: string;
  exampleKey: string;
  tipsKey: string;
}

export const SETTINGS_GUIDE_GROUPS: SettingsGuideGroupDef[] = [
  {
    id: "general",
    titleKey: "settingsGuide.groups.general.title",
    descriptionKey: "settingsGuide.groups.general.description",
  },
  {
    id: "watch",
    titleKey: "settingsGuide.groups.watch.title",
    descriptionKey: "settingsGuide.groups.watch.description",
  },
  {
    id: "archive",
    titleKey: "settingsGuide.groups.archive.title",
    descriptionKey: "settingsGuide.groups.archive.description",
  },
  {
    id: "reminder",
    titleKey: "settingsGuide.groups.reminder.title",
    descriptionKey: "settingsGuide.groups.reminder.description",
  },
  {
    id: "advanced",
    titleKey: "settingsGuide.groups.advanced.title",
    descriptionKey: "settingsGuide.groups.advanced.description",
  },
];

function entry(
  id: string,
  group: SettingsGuideGroup,
  name: string,
): SettingsGuideEntry {
  return {
    id,
    group,
    titleKey: `settings.${name}`,
    introKey: `settingsGuide.${id}.intro`,
    exampleKey: `settingsGuide.${id}.example`,
    tipsKey: `settingsGuide.${id}.tips`,
  };
}

export const SETTINGS_GUIDE: SettingsGuideEntry[] = [
  entry("theme", "general", "theme"),
  entry("language", "general", "language"),
  entry("closeAction", "general", "closeAction"),
  entry("watchedDirs", "watch", "watchedDirs"),
  entry("scheme", "watch", "schemeRow"),
  entry("ignoreRules", "watch", "ignoreRow"),
  entry("classifyMapping", "watch", "mappingRow"),
  entry("labels", "watch", "labelRow"),
  entry("archive", "archive", "archiveRow"),
  entry("reminder", "reminder", "reminderEnabled"),
  entry("homeworkShortcut", "reminder", "homeworkShortcut"),
  entry("projectOpen", "advanced", "projectOpenRow"),
  entry("logDir", "advanced", "logDir"),
  entry("reset", "advanced", "resetSettings"),
];
