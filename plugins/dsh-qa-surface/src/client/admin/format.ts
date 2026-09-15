import type {
  QaAccountRole,
  QaFeedbackReason,
  QaQualityIssueType,
  QaQualitySeverity,
  QaRemediationTarget,
  QaReviewPriority,
  QaReviewStatus,
  QaTranscriptUnavailableReason,
} from "../../types.js";

/**
 * Russian copy for the console's vocabulary. Kept in one module so the pages
 * stay about layout, and so the wording an operator sees is edited in one
 * place rather than hunted across components.
 */

export const ADMIN_ROLE_LABELS: Readonly<Record<QaAccountRole, string>> = {
  admin: "Администратор",
  reviewer: "Ревьюер",
  user: "Пользователь",
};

export const FEEDBACK_RATING_LABELS = {
  positive: "Полезно",
  negative: "Проблема",
} as const;

export const FEEDBACK_REASON_LABELS: Readonly<
  Record<QaFeedbackReason, string>
> = {
  incorrect: "Неверный ответ",
  instruction_not_followed: "Не выполнил инструкцию",
  missing_information: "Не хватает информации",
  outdated_information: "Устаревшая информация",
  tool_issue: "Проблема с инструментом",
  too_verbose: "Слишком подробно",
  too_short: "Слишком кратко",
  other: "Другое",
};

export const REVIEW_STATUS_LABELS: Readonly<Record<QaReviewStatus, string>> = {
  unreviewed: "Не разобрано",
  in_review: "В работе",
  reviewed: "Разобрано",
  needs_followup: "Нужно вернуться",
};

export const REVIEW_PRIORITY_LABELS: Readonly<
  Record<QaReviewPriority, string>
> = {
  high: "Высокий",
  normal: "Обычный",
  low: "Низкий",
};

export const REVIEW_REASON_LABELS = {
  negative_feedback: "Негативная оценка",
  manual: "Отправлено на разбор",
  tool_failure: "Сбой инструмента",
  automatic: "Автоматически",
} as const;

export const SEVERITY_LABELS: Readonly<Record<QaQualitySeverity, string>> = {
  minor: "Незначительная",
  major: "Существенная",
  critical: "Критическая",
};

/**
 * Issue labels grouped by the taxonomy's own branches (spec §21). The groups
 * are only a rendering concern: issue ids stay flat so aggregations never walk
 * a tree.
 */
export const ISSUE_GROUPS: readonly {
  readonly title: string;
  readonly issues: readonly QaQualityIssueType[];
}[] = [
  {
    title: "Ответ",
    issues: [
      "answer.incorrect",
      "answer.incomplete",
      "answer.hallucination",
      "answer.request_not_followed",
      "answer.poor_formatting",
      "answer.communication",
    ],
  },
  {
    title: "Контекст",
    issues: [
      "context.missing_conversation",
      "context.missing_knowledge",
      "context.outdated_knowledge",
    ],
  },
  {
    title: "Инструменты",
    issues: [
      "tool.wrong_selection",
      "tool.should_have_been_used",
      "tool.bad_arguments",
      "tool.failure",
      "tool.unavailable",
    ],
  },
  {
    title: "Навыки и инструкции",
    issues: [
      "skill.missing",
      "skill.wrong",
      "skill.not_followed",
      "skill.prompt_policy",
    ],
  },
  {
    title: "Доступ",
    issues: ["access.missing_capability", "access.excessive_capability"],
  },
  { title: "Прочее", issues: ["other"] },
];

export const ISSUE_LABELS: Readonly<Record<QaQualityIssueType, string>> =
  Object.fromEntries([
    ["answer.incorrect", "Неверный ответ"],
    ["answer.incomplete", "Неполный ответ"],
    ["answer.hallucination", "Выдуманные факты"],
    ["answer.request_not_followed", "Не выполнена просьба"],
    ["answer.poor_formatting", "Плохое оформление"],
    ["answer.communication", "Стиль общения"],
    ["context.missing_conversation", "Потерян контекст диалога"],
    ["context.missing_knowledge", "Не хватает знаний"],
    ["context.outdated_knowledge", "Устаревшие знания"],
    ["tool.wrong_selection", "Выбран не тот инструмент"],
    ["tool.should_have_been_used", "Инструмент не использован"],
    ["tool.bad_arguments", "Неверные аргументы инструмента"],
    ["tool.failure", "Сбой инструмента"],
    ["tool.unavailable", "Инструмент недоступен"],
    ["skill.missing", "Не хватает навыка"],
    ["skill.wrong", "Выбран не тот навык"],
    ["skill.not_followed", "Навык не соблюдён"],
    ["skill.prompt_policy", "Проблема промпта или политики"],
    ["access.missing_capability", "Не хватает возможности"],
    ["access.excessive_capability", "Лишняя возможность"],
    ["other", "Другое"],
  ] satisfies readonly (readonly [QaQualityIssueType, string])[]) as Readonly<
    Record<QaQualityIssueType, string>
  >;

export const TARGET_LABELS: Readonly<Record<QaRemediationTarget, string>> = {
  prompt: "Промпт",
  skill: "Навык",
  tool: "Инструмент",
  knowledge: "База знаний",
  model: "Модель",
  role: "Роль или возможности",
  product_ux: "Интерфейс",
  user_misunderstanding: "Недопонимание пользователя",
  unknown: "Неизвестно",
};

export const TRANSCRIPT_UNAVAILABLE_LABELS: Readonly<
  Record<QaTranscriptUnavailableReason, string>
> = {
  "storage-unavailable": "Хранилище разговоров недоступно на этом стенде.",
  "not-found": "Журнал разговора не найден.",
  unreadable:
    "Журнал разговора не читается: в нём есть событие, неизвестное этой сборке.",
};

/** Percent, or a dash when there is nothing to take a share of. */
export function formatRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/** Local date and time of an ISO stamp, or a dash for an unusable value. */
export function formatStamp(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "—";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "—" : new Date(parsed).toLocaleString("ru-RU");
}

/** Coarse "how long ago", which is what a triage list needs. */
export function formatRelative(iso: string, now = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} дн назад`;
  return formatStamp(iso);
}

/** Milliseconds as a short duration; tool timings are second-scale. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1_000) return `${ms} мс`;
  return `${(ms / 1_000).toFixed(1)} с`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("ru-RU");
}
