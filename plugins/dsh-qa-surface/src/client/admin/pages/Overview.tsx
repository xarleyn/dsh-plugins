import type { QaReviewQueueRow } from "../../../types.js";
import type { QaAdminApi } from "../../types.js";
import { useAdminResource } from "../shared.js";
import {
  FEEDBACK_REASON_LABELS,
  REVIEW_PRIORITY_LABELS,
  REVIEW_REASON_LABELS,
  formatCount,
  formatRate,
  formatRelative,
} from "../copy.js";

/**
 * The overview answers the four questions the admin asks on arrival: is
 * anything broken, are users happy, is a spike coming, what needs me now. It
 * is deliberately not an observability dashboard — latency and tokens belong to
 * the harness's own telemetry.
 */

function Metric(props: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <article className="dsh-qa-admin__metric">
      <span className="dsh-qa-admin__metric-label">{props.label}</span>
      <strong className="dsh-qa-admin__metric-value">{props.value}</strong>
      {props.hint === undefined ? null : (
        <small className="dsh-qa-admin__metric-hint">{props.hint}</small>
      )}
    </article>
  );
}

export function AdminOverview(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly onOpenConversation: (
    conversationId: string,
    messageId?: string,
  ) => void;
  readonly onOpenQueue: () => void;
}) {
  const { data, error, reload } = useAdminResource(
    (signal) => props.api.overview(props.token, signal),
    [props.api, props.token],
  );
  return (
    <section className="dsh-qa-admin__page" aria-label="Обзор">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Обзор</h1>
          <p>Пользователи, использование, обратная связь и разбор ответов.</p>
        </div>
        <button type="button" onClick={() => void reload()}>
          Обновить
        </button>
      </div>
      {error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {error}
        </p>
      )}
      {data === undefined ? (
        <p className="dsh-qa-admin__empty">Загружаю…</p>
      ) : (
        <>
          <div className="dsh-qa-admin__metrics">
            <Metric
              label="Разговоры"
              value={formatCount(data.metrics.conversations)}
              hint={`${formatCount(data.metrics.activeUsers)} пользователей`}
            />
            <Metric
              label="Оценённые ответы"
              value={formatCount(data.metrics.ratedMessages)}
              hint={`${formatRate(data.metrics.ratingRate)} от ответов`}
            />
            <Metric
              label="Положительные оценки"
              value={formatRate(data.metrics.positiveRate)}
              hint={`👍 ${formatCount(data.metrics.positiveRatings)} · 👎 ${formatCount(
                data.metrics.negativeRatings,
              )}`}
            />
            <Metric
              label="Ждут разбора"
              value={formatCount(data.metrics.unreviewedNegatives)}
              hint={`разобрано: ${formatCount(data.metrics.reviewedItems)}`}
            />
          </div>
          <section className="dsh-qa-admin__panel">
            <h2>Требует внимания</h2>
            {data.alerts.length === 0 ? (
              <p className="dsh-qa-admin__empty">
                Ничего срочного: неразобранных негативных оценок нет.
              </p>
            ) : (
              <ul className="dsh-qa-admin__alerts">
                {data.alerts.map((alert, index) => (
                  <li
                    key={`${alert.code}:${alert.subject ?? index}`}
                    className={`dsh-qa-admin__alert dsh-qa-admin__alert--${alert.level}`}
                  >
                    {alert.code === "unreviewed-negatives"
                      ? `${formatCount(alert.count)} негативных оценок без разбора`
                      : alert.code === "subrole-satisfaction"
                        ? `Роль «${alert.subject}»: положительных ${formatRate(
                            alert.rate ?? null,
                          )} против общей доли`
                        : `Причина «${
                            FEEDBACK_REASON_LABELS[
                              alert.subject as keyof typeof FEEDBACK_REASON_LABELS
                            ] ?? alert.subject
                          }» повторяется ${formatCount(alert.count)} раз`}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="dsh-qa-admin__panel">
            <div className="dsh-qa-admin__panel-head">
              <h2>Очередь разбора</h2>
              <button type="button" onClick={props.onOpenQueue}>
                Вся очередь
              </button>
            </div>
            <QueuePreview
              rows={data.queue}
              onOpenConversation={props.onOpenConversation}
            />
          </section>
          <section className="dsh-qa-admin__panel">
            <h2>Последние оценки</h2>
            {data.recentFeedback.length === 0 ? (
              <p className="dsh-qa-admin__empty">Оценок пока нет.</p>
            ) : (
              <ul className="dsh-qa-admin__recent">
                {data.recentFeedback.map((row) => (
                  <li key={row.id}>
                    <span aria-hidden="true">
                      {row.rating === "positive" ? "👍" : "👎"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        props.onOpenConversation(
                          row.conversationId,
                          row.messageId,
                        )
                      }
                    >
                      {row.conversationTitle ?? row.conversationId}
                    </button>
                    <span>{row.displayName}</span>
                    <time title={row.createdAt}>
                      {formatRelative(row.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

export function QueuePreview(props: {
  readonly rows: readonly QaReviewQueueRow[];
  readonly onOpenConversation: (
    conversationId: string,
    messageId?: string,
  ) => void;
}) {
  return props.rows.length === 0 ? (
    <p className="dsh-qa-admin__empty">Очередь пуста.</p>
  ) : (
    <ul className="dsh-qa-admin__queue">
      {props.rows.map((row, index) => (
        <li
          key={`${row.conversationId}:${row.messageId ?? ""}:${index}`}
          className={`dsh-qa-admin__queue-item dsh-qa-admin__queue-item--${row.priority}`}
        >
          <div className="dsh-qa-admin__queue-head">
            <span className="dsh-qa-admin__queue-priority">
              {REVIEW_PRIORITY_LABELS[row.priority]}
            </span>
            <span>{REVIEW_REASON_LABELS[row.reason]}</span>
            <time title={row.raisedAt}>{formatRelative(row.raisedAt)}</time>
          </div>
          <button
            type="button"
            onClick={() =>
              props.onOpenConversation(row.conversationId, row.messageId)
            }
          >
            {row.title ?? row.conversationId}
          </button>
          <span className="dsh-qa-admin__queue-owner">{row.displayName}</span>
        </li>
      ))}
    </ul>
  );
}
