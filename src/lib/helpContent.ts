import { APP_VERSION } from "./constants";
import type { PageKey } from "./nav";
import { SETTINGS_GUIDE } from "./settingsGuide";

/** 帮助中心分区：唯一来源，UI 与搜索共用。 */
export type HelpTab = "guide" | "tasks" | "syntax" | "settings" | "troubleshoot";

export interface HelpArticle {
  /** 稳定 id，同时作为深链目标与搜索 id（如 tasks.files） */
  id: string;
  tab: "tasks" | "troubleshoot";
  titleKey: string;
  summaryKey: string;
  /** i18n 值为有序步骤数组 */
  stepsKey: string;
  keywords: string[];
  related?: string[];
  /** 可选动作按钮：关闭帮助并跳转页面 */
  action?: { labelKey: string; page: PageKey };
}

export interface HelpSearchSource {
  id: string;
  tab: HelpTab;
  titleKey: string;
  summaryKey?: string;
  keywords: string[];
}

export interface WhatsNewEntry {
  version: string;
  /** i18n key 数组，每条一个亮点 */
  items: string[];
  keywords: string[];
}

export const HELP_TABS: { id: HelpTab; labelKey: string }[] = [
  { id: "guide", labelKey: "help.sectionGuide" },
  { id: "tasks", labelKey: "help.sectionTasks" },
  { id: "syntax", labelKey: "help.sectionSyntax" },
  { id: "settings", labelKey: "help.sectionSettings" },
  { id: "troubleshoot", labelKey: "help.sectionTroubleshoot" },
];

export const HELP_TAB_IDS = new Set<string>(HELP_TABS.map((tab) => tab.id));

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "tasks.gettingStarted",
    tab: "tasks",
    titleKey: "helpTasks.gettingStarted.title",
    summaryKey: "helpTasks.gettingStarted.summary",
    stepsKey: "helpTasks.gettingStarted.steps",
    keywords: ["第一次", "上手", "开始", "添加", "扫描", "搜索", "归档", "getting", "started", "first"],
    related: ["tasks.files", "tasks.archive"],
    action: { labelKey: "helpTasks.goSettings", page: "settings" },
  },
  {
    id: "tasks.files",
    tab: "tasks",
    titleKey: "helpTasks.files.title",
    summaryKey: "helpTasks.files.summary",
    stepsKey: "helpTasks.files.steps",
    keywords: ["搜索", "筛选", "排序", "标签", "类型", "归档", "打开", "文件", "search", "filter"],
    related: ["tasks.searchTips", "tasks.archive"],
  },
  {
    id: "tasks.study",
    tab: "tasks",
    titleKey: "helpTasks.study.title",
    summaryKey: "helpTasks.study.summary",
    stepsKey: "helpTasks.study.steps",
    keywords: ["课程表", "作业", "学期", "课程", "提醒", "截止", "schedule", "homework"],
    related: ["tasks.gettingStarted"],
  },
  {
    id: "tasks.projects",
    tab: "tasks",
    titleKey: "helpTasks.projects.title",
    summaryKey: "helpTasks.projects.summary",
    stepsKey: "helpTasks.projects.steps",
    keywords: ["项目", "IDE", "打开", "代码", "VS Code", "JetBrains", "project"],
    related: ["troubleshoot.projectNotDetected", "troubleshoot.fileNotShown"],
    action: { labelKey: "helpTasks.goProjects", page: "projects" },
  },
  {
    id: "tasks.rules",
    tab: "tasks",
    titleKey: "helpTasks.rules.title",
    summaryKey: "helpTasks.rules.summary",
    stepsKey: "helpTasks.rules.steps",
    keywords: ["规则", "分类", "映射", "标签", "方案", "忽略", "rules"],
    related: ["tasks.files"],
    action: { labelKey: "helpTasks.goSettings", page: "settings" },
  },
  {
    id: "tasks.archive",
    tab: "tasks",
    titleKey: "helpTasks.archive.title",
    summaryKey: "helpTasks.archive.summary",
    stepsKey: "helpTasks.archive.steps",
    keywords: ["归档", "撤销", "自动归档", "整理", "archive", "undo"],
    related: ["troubleshoot.archiveMissing"],
  },
  {
    id: "tasks.searchTips",
    tab: "tasks",
    titleKey: "helpTasks.searchTips.title",
    summaryKey: "helpTasks.searchTips.summary",
    stepsKey: "helpTasks.searchTips.steps",
    keywords: ["搜索语法", "type", "label", "size", "before", "after", "筛选", "语法", "search", "syntax"],
    related: ["tasks.files"],
  },
  {
    id: "troubleshoot.fileNotShown",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.fileNotShown.title",
    summaryKey: "helpTroubleshoot.fileNotShown.summary",
    stepsKey: "helpTroubleshoot.fileNotShown.steps",
    keywords: ["文件", "没出现", "扫描", "监控目录", "刷新", "忽略"],
    related: ["tasks.gettingStarted", "troubleshoot.logs"],
    action: { labelKey: "helpTasks.goSettings", page: "settings" },
  },
  {
    id: "troubleshoot.archiveMissing",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.archiveMissing.title",
    summaryKey: "helpTroubleshoot.archiveMissing.summary",
    stepsKey: "helpTroubleshoot.archiveMissing.steps",
    keywords: ["归档", "找不到", "撤销", "归档根", "移动"],
    related: ["tasks.archive"],
  },
  {
    id: "troubleshoot.projectNotDetected",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.projectNotDetected.title",
    summaryKey: "helpTroubleshoot.projectNotDetected.summary",
    stepsKey: "helpTroubleshoot.projectNotDetected.steps",
    keywords: ["项目", "识别", "IDE", "特征文件", "扫描"],
    related: ["tasks.projects", "troubleshoot.logs"],
  },
  {
    id: "troubleshoot.smartScreen",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.smartScreen.title",
    summaryKey: "helpTroubleshoot.smartScreen.summary",
    stepsKey: "helpTroubleshoot.smartScreen.steps",
    keywords: ["安装", "SmartScreen", "签名", "未知发布者", "Windows"],
    related: [],
  },
  {
    id: "troubleshoot.webview2",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.webview2.title",
    summaryKey: "helpTroubleshoot.webview2.summary",
    stepsKey: "helpTroubleshoot.webview2.steps",
    keywords: ["WebView2", "运行时", "安装", "缺少"],
    related: ["troubleshoot.smartScreen"],
  },
  {
    id: "troubleshoot.reset",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.reset.title",
    summaryKey: "helpTroubleshoot.reset.summary",
    stepsKey: "helpTroubleshoot.reset.steps",
    keywords: ["恢复", "默认", "重置", "设置", "乱了"],
    related: ["tasks.rules"],
    action: { labelKey: "helpTasks.goSettings", page: "settings" },
  },
  {
    id: "troubleshoot.logs",
    tab: "troubleshoot",
    titleKey: "helpTroubleshoot.logs.title",
    summaryKey: "helpTroubleshoot.logs.summary",
    stepsKey: "helpTroubleshoot.logs.steps",
    keywords: ["日志", "反馈", "排查", "目录", "log"],
    related: ["troubleshoot.fileNotShown"],
    action: { labelKey: "helpTasks.goSettings", page: "settings" },
  },
];

export const HELP_ARTICLE_IDS = new Set<string>(HELP_ARTICLES.map((a) => a.id));

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "0.8.4",
    items: [
      "helpWhatsNew.v084Item1",
      "helpWhatsNew.v084Item2",
      "helpWhatsNew.v084Item3",
      "helpWhatsNew.v084Item4",
    ],
    keywords: ["更新", "新功能", "0.8.4", "排序", "启动", "校验", "归档", "what's", "new"],
  },
  {
    version: "0.8.5",
    items: [
      "helpWhatsNew.v085Item1",
      "helpWhatsNew.v085Item2",
      "helpWhatsNew.v085Item3",
      "helpWhatsNew.v085Item4",
    ],
    keywords: ["更新", "新功能", "0.8.5", "查询", "搜索", "分页", "AND", "标签", "扫描", "what's", "new"],
  },
];

/** 帮助内搜索的全部条目：文章 + 设置说明 + 语法 + 更新亮点。 */
export const HELP_SEARCH_SOURCES: HelpSearchSource[] = [
  ...HELP_ARTICLES.map((article) => ({
    id: article.id,
    tab: article.tab,
    titleKey: article.titleKey,
    summaryKey: article.summaryKey,
    keywords: article.keywords,
  })),
  ...SETTINGS_GUIDE.map((entry) => ({
    id: `settings.${entry.id}`,
    tab: "settings" as const,
    titleKey: entry.titleKey,
    summaryKey: entry.introKey,
    keywords: entry.keywords ?? [],
  })),
  {
    id: "syntax",
    tab: "syntax",
    titleKey: "help.sectionSyntax",
    summaryKey: "files.syntaxHelpIntro",
    keywords: ["搜索", "语法", "筛选", "type", "label", "state", "size", "before", "after", "and", "+label", "search", "syntax", "filter"],
  },
  ...WHATS_NEW.flatMap((entry) =>
    entry.items.map((itemKey) => ({
      id: `whatsnew.${itemKey}`,
      tab: "guide" as const,
      titleKey: itemKey,
      keywords: entry.keywords,
    })),
  ),
];

/** 当前版本更新亮点；无条目时返回空数组（UI 隐藏区块）。 */
export function whatsNewForVersion(version: string): WhatsNewEntry | undefined {
  return WHATS_NEW.find((entry) => entry.version === version);
}

export function currentWhatsNew(): WhatsNewEntry | undefined {
  return whatsNewForVersion(APP_VERSION);
}
