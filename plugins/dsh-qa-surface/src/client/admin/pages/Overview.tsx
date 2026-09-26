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
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <article className="dsh-qa-admin__metric" data-testid={props.testId}>
      <span
        className="dsh-qa-admin__metric-label"
        data-testid={`${props.testId}-label`}
      >
        {props.label}
      </span>
      <strong
        className="dsh-qa-admin__metric-value"
        data-testid={`${props.testId}-value`}
      >
        {props.value}
      </strong>
      {props.hint === undefined ? null : (
        <small
          className="dsh-qa-admin__metric-hint"
          data-testid={`${props.testId}-hint`}
        >
          {props.hint}
        </small>
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
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-overview"
      aria-label="Обзор"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Обзор</h1>
          <p>Пользователи, использование, обратная связь и разбор ответов.</p>
        </div>
        <button
          type="button"
          data-testid="qa-admin-overview-reload"
          onClick={() => void reload()}
        >
          Обновить
        </button>
      </div>
      {error === undefined ? null : (
        <p
          className="dsh-qa-admin__error"
          data-testid="qa-admin-overview-error"
          role="alert"
        >
          {error}
        </p>
      )}
      {data === undefined ? (
        <p
          className="dsh-qa-admin__empty"
          data-testid="qa-admin-overview-loading"
        >
          Загружаю…
        </p>
      ) : (
        <>
          <div
            className="dsh-qa-admin__metrics"
            data-testid="qa-admin-overview-metrics"
          >
            <Metric
              testId="qa-admin-metric-conversations"
              label="Разговоры"
              value={formatCount(data.metrics.conversations)}
              hint={`${formatCount(data.metrics.activeUsers)} пользователей`}
            />
            <Metric
              testId="qa-admin-metric-rated"
              label="Оценённые ответы"
              value={formatCount(data.metrics.ratedMessages)}
              hint={`${formatRate(data.metrics.ratingRate)} от ответов`}
            />
            <Metric
              testId="qa-admin-metric-positive"
              label="Положительные оценки"
              value={formatRate(data.metrics.positiveRate)}
              hint={`👍 ${formatCount(data.metrics.positiveRatings)} · 👎 ${formatCount(
                data.metrics.negativeRatings,
              )}`}
            />
            <Metric
              testId="qa-admin-metric-unreviewed"
              label="Ждут разбора"
              value={formatCount(data.metrics.unreviewedNegatives)}
              hint={`разобрано: ${formatCount(data.metrics.reviewedItems)}`}
            />
          </div>
          <section
            className="dsh-qa-admin__panel"
            data-testid="qa-admin-overview-alerts"
          >
            <h2>Требует внимания</h2>
            {data.alerts.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-overview-alerts-empty"
              >
                Ничего срочного: неразобранных негативных оценок нет.
              </p>
            ) : (
              <ul
                className="dsh-qa-admin__alerts"
                data-testid="qa-admin-overview-alert-list"
              >
                {data.alerts.map((alert, index) => (
                  <li
                    key={`${alert.code}:${alert.subject ?? index}`}
                    data-testid="qa-admin-overview-alert"
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
          <section
            className="dsh-qa-admin__panel"
            data-testid="qa-admin-overview-queue"
          >
            <div className="dsh-qa-admin__panel-head">
              <h2>Очередь разбора</h2>
              <button
                type="button"
                data-testid="qa-admin-overview-open-queue"
                onClick={props.onOpenQueue}
              >
                Вся очередь
              </button>
            </div>
            <QueuePreview
              rows={data.queue}
              onOpenConversation={props.onOpenConversation}
            />
          </section>
          <section
            className="dsh-qa-admin__panel"
            data-testid="qa-admin-overview-feedback"
          >
            <h2>Последние оценки</h2>
            {data.recentFeedback.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-overview-feedback-empty"
              >
                Оценок пока нет.
              </p>
            ) : (
              <ul
                className="dsh-qa-admin__recent"
                data-testid="qa-admin-overview-feedback-list"
              >
                {data.recentFeedback.map((row) => (
                  <li
                    key={row.id}
                    data-testid="qa-admin-overview-feedback-item"
                  >
                    <span aria-hidden="true">
                      {row.rating === "positive" ? "👍" : "👎"}
                    </span>
                    <button
                      type="button"
                      data-testid="qa-admin-overview-feedback-open"
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
    <p
      className="dsh-qa-admin__empty"
      data-testid="qa-admin-overview-queue-empty"
    >
      Очередь пуста.
    </p>
  ) : (
    <ul
      className="dsh-qa-admin__queue"
      data-testid="qa-admin-overview-queue-list"
    >
      {props.rows.map((row, index) => (
        <li
          key={`${row.conversationId}:${row.messageId ?? ""}:${index}`}
          data-testid="qa-admin-overview-queue-item"
          className={`dsh-qa-admin__queue-item dsh-qa-admin__queue-item--${row.priority}`}
        >
          <div
            className="dsh-qa-admin__queue-head"
            data-testid="qa-admin-overview-queue-head"
          >
            <span
              className="dsh-qa-admin__queue-priority"
              data-testid="qa-admin-overview-queue-priority"
            >
              {REVIEW_PRIORITY_LABELS[row.priority]}
            </span>
            <span data-testid="qa-admin-overview-queue-reason">
              {REVIEW_REASON_LABELS[row.reason]}
            </span>
            <time title={row.raisedAt}>{formatRelative(row.raisedAt)}</time>
          </div>
          <button
            type="button"
            data-testid="qa-admin-overview-queue-open"
            onClick={() =>
              props.onOpenConversation(row.conversationId, row.messageId)
            }
          >
            {row.title ?? row.conversationId}
          </button>
          <span
            className="dsh-qa-admin__queue-owner"
            data-testid="qa-admin-overview-queue-owner"
          >
            {row.displayName}
          </span>
        </li>
      ))}
    </ul>
  );
}
