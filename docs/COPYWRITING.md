# 用户帮助文案规范（COPYWRITING）

> 适用范围：帮助中心、设置说明、空状态提示、新手引导等所有面向普通用户的文案。
> 原则：先说用户能得到什么，再给步骤；不堆术语，不写空话。

## 参考文档

- [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide)：Windows 产品文案惯例，用户导向、动作动词开头。
- [Google Developer Documentation Style Guide](https://developers.google.com/style)：技术文档的清晰与一致要求。
- [中文文案排版指北](https://github.com/mzlogin/chinese-copywriting-guidelines)：中英文混排空格、全半角标点、数字与单位写法。

## 写作规则

- 步骤用祈使句，以动作开头：`打开设置，添加要整理的文件夹。`
- 一个步骤只说一件事；步骤之间按用户操作顺序排列。
- 一段话只表达一个意思，优先短句。
- 使用应用内已有的术语，不自创别名：界面叫“监控目录”，文案就写“监控目录”，不写“监视文件夹”“待整理目录”。
- 向用户解释概念时先说结果：`文件归档后会移动到归档根目录，不会被删除。`
- 不承诺做不到的事；涉及限制时直接说明（如同盘要求、重启生效）。
- 中文与英文之间留一个空格；中文使用全角标点；代码、路径、参数使用反引号包裹。

## 禁用表达

以下表达会让文案显得空洞或像机器生成，一律不用：

- 中文：`值得注意的是`、`轻松搞定`、`无缝`、`赋能`、`解锁`、`稳稳`、`妥妥`、`毋庸置疑`、`总而言之`、`不言而喻`、`让我们`、`告别手动`
- English：`effortlessly`、`seamlessly`、`supercharge`、`unlock`、`dive into`、`let's`、`game-changer`、`at your fingertips`
- 内部标识符：`watched_dirs`、`FileEnumerator`、`PRAGMA`、`keyset`、`scan_diff`、`action_log`、`schema`、`SQLite` 等实现名词不出现在用户文案中。

## 术语对照

| 用户文案 | 内部概念 | 说明 |
| --- | --- | --- |
| 监控目录 | watched_dirs | 设置页同名，不替换 |
| 归档根目录 | archive_root | 描述位置时写“归档根目录” |
| 方案 | scheme | “忽略规则 + 分类映射”的组合模板 |
| 标签 | label | 显示名优先，key 只在搜索语法场景出现 |
| 日志目录 | log_dir | 反馈问题时的定位入口 |

## 校验

新增文案必须通过：

- zh-CN 与 en 的 key 集合完全一致（`npm test` 中的 i18n 校验）。
- 禁用表达扫描（`src/lib/helpCopy.test.ts` 等用例）。
- 注册表字段校验：每篇帮助文章都有标题、摘要、步骤与关键词。
