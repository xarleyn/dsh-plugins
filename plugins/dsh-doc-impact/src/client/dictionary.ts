// Localized strings of the doc-impact settings card, registered into the host
// locale service.
//
// The card does not read this object at render time: declaring `locale:` on the
// seat is what puts the bound translator on its props, and the Host's renderer
// synthesizes that `t` from the namespace registered here. Merging the namespace
// into `LocaleNamespaceMap` below is what makes that seat typed rather than
// assumed — it fixes the key domain `t` accepts, so a card that asks for a string
// this dictionary does not carry stops compiling instead of reading the key back
// at render time. `en` is the single source of that key set, so `zh` can neither
// miss a key nor invent one.
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";

const en = {
  cardDescription: "Settings of the documentation impact plugin",
  unsaved: "Unsaved",
  readOnly: "This connection is read-only; settings cannot be changed.",
  unavailable:
    "The settings are not available yet: this profile has not returned the plugin's configuration, so nothing here can be read or changed.",
  save: "Save",
  saving: "Saving…",
  discard: "Discard",
  saveFailed: "The save did not land; drafts kept — please retry.",
  overridden: "Overridden",
  reset: "Reset",
  invalidNumber: "Enter a positive integer",
  invalidValue: "Invalid input",
  on: "On",
  off: "Off",
  enabledLabel: "Enabled",
  enabledHint: "When off the plugin stays fully silent and checks nothing.",
  steerLabel: "Send reminder messages",
  steerHint:
    "When off the plugin keeps detecting impacts (tools and /doc-impact work) but never steers a reminder into the agent turn.",
  configFileLabel: "Workspace config path",
  configFileHint:
    "Relative to the session working directory; .dsh/doc-impact.yml by default.",
  modeLabel: "Default mode",
  modeHint: "Used by workspace rules that do not declare an explicit mode.",
  maxReminderRoundsLabel: "Max reminder rounds",
  maxReminderRoundsHint: "Steer limit for the same impact in strict modes.",
  onLimitLabel: "On limit",
  onLimitHint:
    "allow finishes silently; warn logs; error sends a final notice.",
  reminderTemplateLabel: "Reminder message template",
  reminderTemplateHint:
    "Placeholders: {intro} attribution line, {count} triggered count, {body} impact list (required), {tail} mode-specific instructions.",
  limitTemplateLabel: "Limit notice template",
  limitTemplateHint:
    "Placeholders: {rounds} rounds used, {impacts} unresolved impact list (required).",
  maxSnapshotFilesLabel: "Max snapshot files",
  maxSnapshotFilesHint:
    "Baseline snapshot cap; detection degrades gracefully beyond it.",
  debugLabel: "Debug logging",
  debugHint: "Log baselines, change detection, and reminders.",
  invalidTemplate:
    "The template is missing a required placeholder; keep it to save.",
};

/** One dictionary key of this card's locale namespace. */
export type LocaleKey = keyof typeof en;

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dsh-doc-impact": LocaleKey;
  }
}

/**
 * The translate seat the Host hands this card, narrowed to the namespace above:
 * its key domain is this dictionary's keys plus the shared common vocabulary.
 */
export type Translate = TranslateNS<"dsh-doc-impact">;

const zh: Record<LocaleKey, string> = {
  cardDescription: "文档影响检查插件的运行设置",
  unsaved: "未保存",
  readOnly: "当前连接为只读，无法修改设置。",
  unavailable:
    "设置暂不可用：Host 尚未返回该插件的配置，因此这里既读不到也改不了任何值。",
  save: "保存",
  saving: "保存中…",
  discard: "放弃更改",
  saveFailed: "保存未生效，草稿已保留，请重试。",
  overridden: "已覆盖",
  reset: "重置",
  invalidNumber: "请输入正整数",
  invalidValue: "输入无效",
  on: "开",
  off: "关",
  enabledLabel: "启用插件",
  enabledHint: "关闭后插件完全静默，不检查任何影响。",
  steerLabel: "发送提醒消息",
  steerHint:
    "关闭后插件继续检测影响（工具与 /doc-impact 可用），但不再向代理注入提醒消息。",
  configFileLabel: "工作区配置路径",
  configFileHint: "相对会话工作目录，默认 .dsh/doc-impact.yml。",
  modeLabel: "默认模式",
  modeHint: "工作区规则未显式声明 mode 时的默认值。",
  maxReminderRoundsLabel: "最大提醒轮数",
  maxReminderRoundsHint: "严格模式下同一 impact 的最大提醒次数。",
  onLimitLabel: "超限行为",
  onLimitHint: "allow 静默放行；warn 记录警告；error 发送最终提示。",
  reminderTemplateLabel: "提醒消息模板",
  reminderTemplateHint:
    "支持占位符 {intro}（归因说明）、{count}（触发数）、{body}（impact 列表，必填）、{tail}（模式相关指引）。",
  limitTemplateLabel: "超限提示模板",
  limitTemplateHint:
    "支持占位符 {rounds}（已用轮数）、{impacts}（未解决 impact 列表，必填）。",
  maxSnapshotFilesLabel: "快照文件上限",
  maxSnapshotFilesHint: "基线快照的最大文件数，超出后降级运行。",
  debugLabel: "调试日志",
  debugHint: "输出基线、变更与提醒的调试信息。",
  invalidTemplate: "模板缺少必填占位符，请保留后保存。",
};

/** The dictionaries `locale.register` files under this card's namespace. */
export const DICT: Record<string, Record<LocaleKey, string>> = { en, zh };
