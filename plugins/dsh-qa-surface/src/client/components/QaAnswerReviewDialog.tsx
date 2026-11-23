import type { QaAnswerReview, QaAnswerReviewIssue } from "../../types.js";
import { QaReviewIcon, reviewCopy } from "./QaAnswerReviewStatus.js";
import { QaModal } from "./QaModal.js";

const severityLabels: Record<QaAnswerReviewIssue["severity"], string> = {
  critical: "Критическое",
  major: "Существенное",
  minor: "Незначительное",
};

export function QaAnswerReviewDialog({
  review,
  onClose,
}: {
  readonly review: QaAnswerReview;
  readonly onClose: () => void;
}) {
  const { status, details, documents } = review;
  const [label, fallback] = reviewCopy[status];
  const issues = details?.issues ?? [];
  const omitted = details?.omittedIssues ?? 0;
  const hasIssues = issues.length > 0 || omitted > 0;
  const description =
    status === "pass" && hasIssues
      ? "Рецензент принял эту версию ответа."
      : fallback;
  return (
    <QaModal
      open
      title="Заключение рецензента"
      closeLabel="Закрыть заключение рецензента"
      onClose={onClose}
    >
      <div className="dsh-qa-review-details">
        <div className="dsh-qa-review-details__result">
          <p className="dsh-qa-review-details__verdict" data-status={status}>
            <QaReviewIcon status={status} />
            {label}
          </p>
          <p>{details?.summary || description}</p>
        </div>
        {hasIssues && (
          <section className="dsh-qa-review-details__issues">
            <h3>Замечания</h3>
            <ul>
              {issues.map(
                ({ severity, claim, problem, requiredFix }, index) => (
                  // A captured verdict is immutable, including the list order.
                  <li key={index} className="dsh-qa-review-details__issue">
                    <span
                      className="dsh-qa-review-details__severity"
                      data-severity={severity}
                    >
                      {severityLabels[severity]}
                    </span>
                    {claim && <strong>{claim}</strong>}
                    {problem && <p>{problem}</p>}
                    {requiredFix && requiredFix !== claim && (
                      <div className="dsh-qa-review-details__fix">
                        <strong>Что исправить</strong>
                        <p>{requiredFix}</p>
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
            {omitted > 0 && (
              <p>
                В исходном вердикте замечаний больше. Здесь показаны первые{" "}
                {issues.length}.
              </p>
            )}
          </section>
        )}
        {status === "revise" && details === undefined && (
          <p>Для этой проверки сохранился только вердикт.</p>
        )}
        {documents && documents.length > 0 && (
          <details className="dsh-qa-review-details__documents">
            <summary>Проверенные файлы ({documents.length})</summary>
            <ul>
              {documents.map(({ name, sha256, sourceSha256 }) => (
                <li key={`${name}:${sha256}`}>
                  <strong>{name}</strong>
                  <p>Исходных файлов — {sourceSha256.length}</p>
                  <p>
                    SHA-256 <code>{sha256}</code>
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </QaModal>
  );
}
