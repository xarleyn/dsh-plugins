import { memo, useState } from "react";
import type { QaApprovalDecision, QaPendingApproval } from "../../types.js";

export interface QaApprovalProps {
  readonly approvals: readonly QaPendingApproval[];
  readonly onAnswer: (
    requestId: string,
    decision: QaApprovalDecision,
  ) => Promise<void>;
}

/**
 * The tool calls a composed gate parked for a person. One row per request, the
 * gate's own reason on top, and the two answers stock DSH offers: refuse, or
 * let this one call through. Nothing here decides on its own — an unanswered
 * request simply keeps the turn waiting.
 */
export const QaApproval = memo(function QaApproval(props: QaApprovalProps) {
  const [answering, setAnswering] = useState<string | null>(null);
  const approvals = props.approvals;
  if (approvals.length === 0) return null;
  const answer = (requestId: string, decision: QaApprovalDecision) => {
    setAnswering(requestId);
    void props.onAnswer(requestId, decision).finally(() => {
      setAnswering((current) => (current === requestId ? null : current));
    });
  };
  return (
    <div className="dsh-qa-approvals" aria-label="Запросы на одобрение">
      {approvals.map((approval) => (
        <section
          key={approval.id}
          className="dsh-qa-approval"
          aria-live="polite"
        >
          <p className="dsh-qa-approval__strip">
            <span className="dsh-qa-approval__dot" aria-hidden="true" />
            Ожидает одобрения
          </p>
          <p className="dsh-qa-approval__reason">
            {approval.reason ??
              `Инструмент «${approval.toolName}» запрашивает разрешение.`}
          </p>
          <p className="dsh-qa-approval__tool">
            <code>{approval.toolName}</code>
            {approval.delegated ? (
              <span className="dsh-qa-approval__delegated">
                запросил субагент
              </span>
            ) : null}
          </p>
          <div className="dsh-qa-approval__actions">
            <button
              type="button"
              className="dsh-qa-approval__button"
              disabled={answering === approval.id}
              onClick={() => answer(approval.id, "rejected")}
            >
              Отклонить
            </button>
            <button
              type="button"
              className="dsh-qa-approval__button dsh-qa-approval__button--primary"
              disabled={answering === approval.id}
              onClick={() => answer(approval.id, "allowed-once")}
            >
              Разрешить один раз
            </button>
          </div>
        </section>
      ))}
    </div>
  );
});
