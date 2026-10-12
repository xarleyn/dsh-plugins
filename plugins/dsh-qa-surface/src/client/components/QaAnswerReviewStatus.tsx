import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { QaAnswerReview } from "../../types/answer-review.js";

const copy: Record<QaAnswerReview["status"], readonly [string, string]> = {
  reviewing: [
    "Проверяем ответ",
    "Идёт независимая проверка этой версии ответа.",
  ],
  recovering: [
    "Повторяем проверку",
    "Проверяющий не передал итог. Выполняется одна повторная проверка того же ответа.",
  ],
  pass: [
    "Ответ проверен",
    "Независимая проверка этой версии ответа прошла. Это актуальный результат проверки.",
  ],
  revise: [
    "Нужны исправления",
    "Независимая проверка нашла замечания к этой версии ответа.",
  ],
  failure: [
    "Проверка не завершена",
    "Получить итог независимой проверки не удалось. Достоверность ответа не подтверждена проверкой.",
  ],
  cancelled: [
    "Проверка остановлена",
    "Проверка остановлена вместе с запросом. Достоверность ответа не подтверждена проверкой.",
  ],
  waived: [
    "Без независимой проверки",
    "Для этого ответа проверка отключена по запросу пользователя.",
  ],
};

export function QaAnswerReviewStatus({
  review,
}: {
  readonly review: QaAnswerReview;
}) {
  const [label, detail] = copy[review.status];
  return (
    <span
      className="dsh-qa-review"
      data-status={review.status}
      data-testid="qa-answer-review"
      role="status"
      title={detail}
      aria-label={`${label}. ${detail}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {review.status === "pass" ? (
          <path d="m3 8 3 3 7-7" />
        ) : (
          <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 4.5V8l2 1.5" />
          </>
        )}
      </svg>
      {label}
    </span>
  );
}

export function QaNativeAnswerReviewStatus({
  node,
}: PropsRuntime<"conversation.chat.node", "qa-answer-review">) {
  return (
    <div className="dsh-qa-review-row">
      <QaAnswerReviewStatus review={node.data} />
    </div>
  );
}

export const QA_REVIEW_STYLES = `
.dsh-qa-review-row{padding:4px 0 12px}
.dsh-qa-review{display:inline-flex;align-items:center;gap:6px;max-width:100%;margin:8px 0 0;padding:4px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px}
.dsh-qa-review svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-review[data-status=pass]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary))}
`;
