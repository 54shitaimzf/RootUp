/** IDE 官方下载链接（仅官方域名，配合后端 URL 白名单）。 */
export interface IdeGuideEntry {
  key: string;
  name: string;
  url: string;
}

export const IDE_GUIDE: IdeGuideEntry[] = [
  { key: "vscode", name: "VS Code", url: "https://code.visualstudio.com/" },
  { key: "cursor", name: "Cursor", url: "https://cursor.com/" },
  { key: "idea", name: "IntelliJ IDEA", url: "https://www.jetbrains.com/idea/" },
  { key: "pycharm", name: "PyCharm", url: "https://www.jetbrains.com/pycharm/" },
  { key: "rustrover", name: "RustRover", url: "https://www.jetbrains.com/rust/" },
  { key: "goland", name: "GoLand", url: "https://www.jetbrains.com/go/" },
];

/** 按项目类型推荐 IDE（key 指向 IDE_GUIDE）。 */
export const LANGUAGE_IDE_RECOMMENDATION: {
  labelKey: string;
  ides: string[];
}[] = [
  { labelKey: "projects.kindRust", ides: ["rustrover", "vscode"] },
  { labelKey: "projects.kindPython", ides: ["pycharm", "vscode"] },
  { labelKey: "projects.kindJava", ides: ["idea"] },
  { labelKey: "projects.kindNode", ides: ["vscode", "cursor"] },
  { labelKey: "projects.kindCSharp", ides: ["vscode"] },
  { labelKey: "projects.kindGo", ides: ["goland", "vscode"] },
];
