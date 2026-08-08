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
  /** 帮助搜索关键词（可选，为空时仅按标题/摘要命中） */
  keywords?: string[];
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

const ENTRY_KEYWORDS: Record<string, string[]> = {
  theme: ["主题", "浅色", "深色", "外观", "theme"],
  language: ["语言", "中文", "English", "语言切换", "language"],
  closeAction: ["关闭", "后台", "退出", "close"],
  watchedDirs: ["监控目录", "添加", "文件夹", "目录", "扫描", "watched", "folders"],
  scheme: ["方案", "规则", "模板", "scheme"],
  ignoreRules: ["忽略", "规则", "排除", "ignore"],
  classifyMapping: ["分类", "映射", "扩展名", "mapping"],
  labels: ["标签", "图标", "颜色", "label"],
  archive: ["归档", "自动归档", "撤销", "archive"],
  reminder: ["提醒", "作业", "截止", "reminder"],
  homeworkShortcut: ["快捷方式", "作业", "桌面", "shortcut"],
  projectOpen: ["IDE", "打开", "项目", "命令", "project"],
  logDir: ["日志", "目录", "log"],
  reset: ["恢复", "默认", "重置", "reset"],
};

function entry(id: string, group: SettingsGuideGroup, name: string): SettingsGuideEntry {
  return {
    id,
    group,
    titleKey: `settings.${name}`,
    introKey: `settingsGuide.${id}.intro`,
    exampleKey: `settingsGuide.${id}.example`,
    tipsKey: `settingsGuide.${id}.tips`,
    keywords: ENTRY_KEYWORDS[id] ?? [],
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
