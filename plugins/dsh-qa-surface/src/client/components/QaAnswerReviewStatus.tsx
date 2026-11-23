import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { QaAnswerReview } from "../../types/answer-review.js";

export const reviewCopy: Record<
  QaAnswerReview["status"],
  readonly [string, string]
> = {
  reviewing: [
    "Идёт проверка ответа",
    "Рецензент проверяет эту версию. Текст ещё может измениться.",
  ],
  recovering: [
    "Повторяем проверку",
    "Первая проверка не дала результата. Рецензент проверяет ту же версию ещё раз.",
  ],
  pass: [
    "Ответ проверен",
    "Рецензент завершил проверку этой версии без замечаний.",
  ],
  revise: [
    "Нужны исправления",
    "Рецензент нашёл замечания к этой версии ответа.",
  ],
  failure: [
    "Проверка не завершена",
    "Получить заключение рецензента не удалось.",
  ],
  cancelled: [
    "Проверка остановлена",
    "Текст остался в чате без заключения рецензента.",
  ],
  waived: [
    "Без независимой проверки",
    "Для этого ответа проверка отключена по запросу пользователя.",
  ],
};

export function QaAnswerReviewStatus({
  review,
  onOpen,
}: {
  readonly review: QaAnswerReview;
  readonly onOpen?: ((review: QaAnswerReview) => void) | undefined;
}) {
  const docs = review.documents;
  const [label, detail] =
    docs?.length && (review.status === "pass" || review.status === "revise")
      ? [
          `${review.status === "pass" ? "Проверен DOCX" : "Замечания к DOCX"} · ${docs.map((d) => d.name).join(", ")}`,
          docs
            .map(
              (d) =>
                `${d.name} · SHA-256 ${d.sha256} · исходных файлов ${d.sourceSha256.length}`,
            )
            .join("\n"),
        ]
      : reviewCopy[review.status];
  if (onOpen && (review.status === "pass" || review.status === "revise")) {
    return (
      <button
        type="button"
        className="dsh-qa-message__detail-action"
        data-status={review.status}
        data-testid="qa-answer-review"
        aria-haspopup="dialog"
        onClick={() => onOpen(review)}
      >
        <QaReviewIcon status={review.status} />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <span
      className="dsh-qa-review"
      data-status={review.status}
      data-testid="qa-answer-review"
      role="status"
      title={detail}
      aria-label={`${label}. ${detail}`}
    >
      <QaReviewIcon status={review.status} />
      {label}
    </span>
  );
}

export function QaReviewIcon({ status }: { status: QaAnswerReview["status"] }) {
  return (
    <svg
      className="dsh-qa-review-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {status === "pass" ? (
        <path d="m3 8 3 3 7-7" />
      ) : (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path
            d={status === "revise" ? "M8 5v3.5m0 2.25v.01" : "M8 4.5V8l2 1.5"}
          />
        </>
      )}
    </svg>
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
.dsh-qa-review-icon{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.dsh-qa-review[data-status=pass]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary))}
`;
