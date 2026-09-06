// Localized strings of the doc-impact settings card; used directly by the
// fallback dictionary and registered into the host locale service.

export const DICT: Record<string, Record<string, string>> = {
  zh: {
    cardTitle: "Doc Impact 文档联动",
    cardDescription: "文档影响检查插件的运行设置",
    unsaved: "未保存",
    readOnly: "当前连接为只读，无法修改设置。",
    save: "保存",
    saving: "保存中…",
    discard: "放弃更改",
    saveFailed: "保存未生效，草稿已保留，请重试。",
    expand: "展开",
    collapse: "收起",
    overridden: "已覆盖",
    reset: "重置",
    invalidNumber: "请输入正整数",
    invalidValue: "输入无效",
    on: "开",
    off: "关",
    enabledLabel: "启用插件",
    enabledHint: "关闭后插件完全静默，不检查任何影响。",
    configFileLabel: "工作区配置路径",
    configFileHint: "相对会话工作目录，默认 .dsh/doc-impact.yml。",
    modeLabel: "默认模式",
    modeHint: "工作区规则未显式声明 mode 时的默认值。",
    maxReminderRoundsLabel: "最大提醒轮数",
    maxReminderRoundsHint: "严格模式下同一 impact 的最大提醒次数。",
    onLimitLabel: "超限行为",
    onLimitHint: "allow 静默放行；warn 记录警告；error 发送最终提示。",
    maxSnapshotFilesLabel: "快照文件上限",
    maxSnapshotFilesHint: "基线快照的最大文件数，超出后降级运行。",
    debugLabel: "调试日志",
    debugHint: "输出基线、变更与提醒的调试信息。"
  },
  en: {
    cardTitle: "Doc Impact",
    cardDescription: "Settings of the documentation impact plugin",
    unsaved: "Unsaved",
    readOnly: "This connection is read-only; settings cannot be changed.",
    save: "Save",
    saving: "Saving…",
    discard: "Discard",
    saveFailed: "The save did not land; drafts kept — please retry.",
    expand: "Expand",
    collapse: "Collapse",
    overridden: "Overridden",
    reset: "Reset",
    invalidNumber: "Enter a positive integer",
    invalidValue: "Invalid input",
    on: "On",
    off: "Off",
    enabledLabel: "Enabled",
    enabledHint: "When off the plugin stays fully silent and checks nothing.",
    configFileLabel: "Workspace config path",
    configFileHint: "Relative to the session working directory; .dsh/doc-impact.yml by default.",
    modeLabel: "Default mode",
    modeHint: "Used by workspace rules that do not declare an explicit mode.",
    maxReminderRoundsLabel: "Max reminder rounds",
    maxReminderRoundsHint: "Steer limit for the same impact in strict modes.",
    onLimitLabel: "On limit",
    onLimitHint: "allow finishes silently; warn logs; error sends a final notice.",
    maxSnapshotFilesLabel: "Max snapshot files",
    maxSnapshotFilesHint: "Baseline snapshot cap; detection degrades gracefully beyond it.",
    debugLabel: "Debug logging",
    debugHint: "Log baselines, change detection, and reminders."
  }
};

export function fallbackT(key: string): string {
  const zh = DICT.zh![key];
  return zh === undefined ? key : zh;
}

