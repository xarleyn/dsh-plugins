import { useCallback, useEffect, useState } from "react";
import type {
  QaAdminAuditEvent,
  QaAuditQuery,
  QaFeedbackQuery,
  QaFeedbackRating,
  QaFeedbackReason,
  QaFeedbackRow,
  QaQualityMetrics,
} from "../../../types.js";
import type { QaAdminApi } from "../../types.js";
import {
  FEEDBACK_REASON_LABELS,
  REVIEW_STATUS_LABELS,
  formatCount,
  formatRate,
  formatStamp,
} from "../copy.js";
import {
  Badge,
  FilterField,
  Pager,
  adminErrorMessage,
  useAdminResource,
} from "../shared.js";

const PAGE_SIZE = 25;

/** The feedback table: every rating against the exact answer it judged. */
export function AdminFeedback(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly onOpenConversation: (
    conversationId: string,
    messageId?: string,
  ) => void;
}) {
  const [rating, setRating] = useState<QaFeedbackRating | "">("");
  const [reason, setReason] = useState<QaFeedbackReason | "">("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [rows, setRows] = useState<readonly QaFeedbackRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (next: string | null, append: boolean) => {
      setLoading(true);
      const query: QaFeedbackQuery = {
        rating: rating === "" ? null : rating,
        reason: reason === "" ? null : reason,
        reviewStatus:
          reviewStatus === ""
            ? null
            : (reviewStatus as QaFeedbackQuery["reviewStatus"]),
      };
      const result = await props.api.feedback(
        props.token,
        query,
        next,
        PAGE_SIZE,
      );
      setLoading(false);
      if (!result.ok) return;
      setTotal(result.value.total);
      setCursor(result.value.nextCursor);
      setRows((current) =>
        append ? [...current, ...result.value.items] : result.value.items,
      );
    },
    [props.api, props.token, rating, reason, reviewStatus],
  );

  useEffect(() => {
    void load(null, false);
  }, [load]);

  return (
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-feedback"
      aria-label="Обратная связь"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Обратная связь</h1>
          <p>
            Оценка пользователя — это сигнал удовлетворённости, а не измерение
            точности ответа.
          </p>
        </div>
      </div>
      <div
        className="dsh-qa-admin__filters"
        data-testid="qa-admin-feedback-filters"
      >
        <FilterField label="Оценка" testId="qa-admin-feedback-filter-rating">
          <select
            data-testid="qa-admin-feedback-rating"
            value={rating}
            onChange={(event) =>
              setRating(event.currentTarget.value as QaFeedbackRating | "")
            }
          >
            <option value="">Любая</option>
            <option value="positive">👍</option>
            <option value="negative">👎</option>
          </select>
        </FilterField>
        <FilterField label="Причина" testId="qa-admin-feedback-filter-reason">
          <select
            data-testid="qa-admin-feedback-reason"
            value={reason}
            onChange={(event) =>
              setReason(event.currentTarget.value as QaFeedbackReason | "")
            }
          >
            <option value="">Любая</option>
            {(Object.keys(FEEDBACK_REASON_LABELS) as QaFeedbackReason[]).map(
              (value) => (
                <option key={value} value={value}>
                  {FEEDBACK_REASON_LABELS[value]}
                </option>
              ),
            )}
          </select>
        </FilterField>
        <FilterField label="Разбор" testId="qa-admin-feedback-filter-review">
          <select
            data-testid="qa-admin-feedback-review-status"
            value={reviewStatus}
            onChange={(event) => setReviewStatus(event.currentTarget.value)}
          >
            <option value="">Любой</option>
            <option value="unreviewed">Не разобрано</option>
            <option value="reviewed">Разобрано</option>
            <option value="needs_followup">Нужно вернуться</option>
          </select>
        </FilterField>
      </div>
      {rows.length === 0 ? (
        <p
          className="dsh-qa-admin__empty"
          data-testid="qa-admin-feedback-empty"
        >
          {loading ? "Загружаю…" : "Оценок пока нет."}
        </p>
      ) : (
        <table
          className="dsh-qa-admin__table"
          data-testid="qa-admin-feedback-table"
        >
          <thead>
            <tr>
              <th>Оценка</th>
              <th>Пользователь</th>
              <th>Профиль</th>
              <th>Разговор</th>
              <th>Причина</th>
              <th>Дата</th>
              <th>Разбор</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid="qa-admin-feedback-row">
                <td data-testid="qa-admin-feedback-rating-value">
                  {row.rating === "positive" ? "👍" : "👎"}
                </td>
                <td>{row.displayName}</td>
                <td>{row.subroleId === "" ? "—" : row.subroleId}</td>
                <td data-testid="qa-admin-feedback-conversation">
                  {row.conversationTitle ?? row.conversationId}
                </td>
                <td>
                  {(row.reasons ?? [])
                    .map((value) => FEEDBACK_REASON_LABELS[value])
                    .join(", ") || "—"}
                  {row.comment === undefined ? null : (
                    <small>{row.comment}</small>
                  )}
                </td>
                <td>{formatStamp(row.createdAt)}</td>
                <td data-testid="qa-admin-feedback-review">
                  <Badge
                    tone={
                      row.reviewStatus === "reviewed" ? "positive" : "neutral"
                    }
                  >
                    {REVIEW_STATUS_LABELS[row.reviewStatus]}
                  </Badge>
                </td>
                <td>
                  <button
                    type="button"
                    data-testid="qa-admin-feedback-open"
                    onClick={() =>
                      props.onOpenConversation(
                        row.conversationId,
                        row.messageId,
                      )
                    }
                  >
                    К ответу
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager
        total={total}
        shown={rows.length}
        hasMore={cursor !== null}
        loading={loading}
        onMore={() => void load(cursor, true)}
        onReset={() => void load(null, false)}
      />
    </section>
  );
}

/** Issue distribution, per-subrole satisfaction and the trend over time. */
export function AdminQuality(props: {
  readonly api: QaAdminApi;
  readonly token: string;
}) {
  const resource = useAdminResource(
    (signal) => props.api.metrics(props.token, signal),
    [props.api, props.token],
  );
  const metrics: QaQualityMetrics | undefined = resource.data;
  return (
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-quality"
      aria-label="Аналитика качества"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Аналитика</h1>
          <p>
            Доли считаются по оценённым ответам. Это пользовательский сигнал, а
            не измеренная точность.
          </p>
        </div>
        <button
          type="button"
          data-testid="qa-admin-quality-reload"
          onClick={() => void resource.reload()}
        >
          Обновить
        </button>
      </div>
      {resource.error === undefined ? null : (
        <p
          className="dsh-qa-admin__error"
          data-testid="qa-admin-quality-error"
          role="alert"
        >
          {adminErrorMessage(resource.error)}
        </p>
      )}
      {metrics === undefined ? (
        <p
          className="dsh-qa-admin__empty"
          data-testid="qa-admin-quality-loading"
        >
          Загружаю…
        </p>
      ) : (
        <>
          <dl
            className="dsh-qa-admin__facts dsh-qa-admin__facts--wide"
            data-testid="qa-admin-quality-facts"
          >
            <dt>Разговоры</dt>
            <dd data-testid="qa-admin-quality-conversations">
              {formatCount(metrics.conversations)}
            </dd>
            <dt>Пользователи с разговорами</dt>
            <dd data-testid="qa-admin-quality-active-users">
              {formatCount(metrics.activeUsers)}
            </dd>
            <dt>Ответы ассистента</dt>
            <dd data-testid="qa-admin-quality-assistant-messages">
              {formatCount(metrics.assistantMessages)}
            </dd>
            <dt>Оценённые ответы</dt>
            <dd data-testid="qa-admin-quality-rated-messages">
              {formatCount(metrics.ratedMessages)}
            </dd>
            <dt>Доля оценённых</dt>
            <dd data-testid="qa-admin-quality-rating-rate">
              {formatRate(metrics.ratingRate)}
            </dd>
            <dt>Положительных</dt>
            <dd data-testid="qa-admin-quality-positive-ratings">
              {formatCount(metrics.positiveRatings)}
            </dd>
            <dt>Негативных</dt>
            <dd data-testid="qa-admin-quality-negative-ratings">
              {formatCount(metrics.negativeRatings)}
            </dd>
            <dt>Положительная доля</dt>
            <dd data-testid="qa-admin-quality-positive-rate">
              {formatRate(metrics.positiveRate)}
            </dd>
            <dt>Неразобранных негативных</dt>
            <dd data-testid="qa-admin-quality-unreviewed-negatives">
              {formatCount(metrics.unreviewedNegatives)}
            </dd>
            <dt>Разобрано</dt>
            <dd data-testid="qa-admin-quality-reviewed-items">
              {formatCount(metrics.reviewedItems)}
            </dd>
          </dl>
          <section
            className="dsh-qa-admin__panel"
            data-testid="qa-admin-quality-by-subrole"
          >
            <h2>Положительная доля по профилям</h2>
            {metrics.bySubrole.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-quality-subrole-empty"
              >
                Оценок по профилям нет.
              </p>
            ) : (
              <table
                className="dsh-qa-admin__table"
                data-testid="qa-admin-quality-subrole-table"
              >
                <thead>
                  <tr>
                    <th>Профиль</th>
                    <th>Оценено</th>
                    <th>👍</th>
                    <th>👎</th>
                    <th>Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.bySubrole.map((row) => (
                    <tr
                      key={row.key}
                      data-testid="qa-admin-quality-subrole-row"
                    >
                      <td>{row.label}</td>
                      <td>{formatCount(row.rated)}</td>
                      <td>{formatCount(row.positive)}</td>
                      <td>{formatCount(row.negative)}</td>
                      <td data-testid="qa-admin-quality-subrole-rate">
                        {formatRate(row.positiveRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section
            className="dsh-qa-admin__panel"
            data-testid="qa-admin-quality-issues"
          >
            <h2>Проблемы по вердиктам ревьюеров</h2>
            {metrics.issues.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-quality-issues-empty"
              >
                Разборов пока нет.
              </p>
            ) : (
              <ul
                className="dsh-qa-admin__issues-list"
                data-testid="qa-admin-quality-issues-list"
              >
                {metrics.issues.map((row) => (
                  <li
                    key={row.issue}
                    data-testid="qa-admin-quality-issues-item"
                  >
                    <span>{row.issue}</span>
                    <strong data-testid="qa-admin-quality-issues-count">
                      {formatCount(row.count)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            className="dsh-qa-admin__panel"
            data-testid="qa-admin-quality-trend"
          >
            <h2>Оценки по дням</h2>
            {metrics.trend.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-quality-trend-empty"
              >
                Оценок пока нет.
              </p>
            ) : (
              <ul
                className="dsh-qa-admin__trend"
                data-testid="qa-admin-quality-trend-list"
              >
                {metrics.trend.map((point) => (
                  <li
                    key={point.date}
                    data-testid="qa-admin-quality-trend-item"
                  >
                    <span>{point.date}</span>
                    <span data-testid="qa-admin-quality-trend-positive">
                      👍 {formatCount(point.positive)}
                    </span>
                    <span data-testid="qa-admin-quality-trend-negative">
                      👎 {formatCount(point.negative)}
                    </span>
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

/** Every administrative action, newest first, from both writers. */
export function AdminAudit(props: {
  readonly api: QaAdminApi;
  readonly token: string;
}) {
  const [rows, setRows] = useState<readonly QaAdminAuditEvent[]>([]);
  const [action, setAction] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (next: string | null, append: boolean) => {
      setLoading(true);
      const query: QaAuditQuery = {
        action: action === "" ? null : (action as QaAuditQuery["action"]),
      };
      const result = await props.api.audit(props.token, query, next, PAGE_SIZE);
      setLoading(false);
      if (!result.ok) return;
      setTotal(result.value.total);
      setCursor(result.value.nextCursor);
      setRows((current) =>
        append ? [...current, ...result.value.items] : result.value.items,
      );
    },
    [props.api, props.token, action],
  );

  useEffect(() => {
    void load(null, false);
  }, [load]);

  return (
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-audit"
      aria-label="Аудит"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Аудит</h1>
          <p>
            Изменения доступа, назначений и разборов. Запись хранит снимок «до»
            и «после».
          </p>
        </div>
      </div>
      <div
        className="dsh-qa-admin__filters"
        data-testid="qa-admin-audit-filters"
      >
        <FilterField label="Действие" testId="qa-admin-audit-filter-action">
          <select
            data-testid="qa-admin-audit-action-select"
            value={action}
            onChange={(event) => setAction(event.currentTarget.value)}
          >
            <option value="">Любое</option>
            <option value="authorization.changed">Роль изменена</option>
            <option value="user.disabled">Пользователь отключён</option>
            <option value="user.enabled">Пользователь включён</option>
            <option value="subrole.assignment.changed">
              Назначение изменено
            </option>
            <option value="subrole.created">Саброль создана</option>
            <option value="subrole.updated">Саброль изменена</option>
            <option value="subrole.deleted">Саброль удалена</option>
            <option value="common_capabilities.updated">
              Общие возможности изменены
            </option>
            <option value="conversation.reviewed">Разговор разобран</option>
            <option value="review.updated">Разбор обновлён</option>
            <option value="review.queued">Отправлено на разбор</option>
          </select>
        </FilterField>
      </div>
      {rows.length === 0 ? (
        <p className="dsh-qa-admin__empty" data-testid="qa-admin-audit-empty">
          {loading ? "Загружаю…" : "Изменений пока нет."}
        </p>
      ) : (
        <ol className="dsh-qa-audit" data-testid="qa-admin-audit-list">
          {rows.map((event) => (
            <li key={event.id} data-testid="qa-admin-audit-item">
              <time title={event.timestamp}>
                {formatStamp(event.timestamp)}
              </time>
              <strong data-testid="qa-admin-audit-event-action">
                {event.action}
              </strong>
              <span data-testid="qa-admin-audit-target">
                {event.targetId ?? event.targetType ?? "—"}
              </span>
              <code data-testid="qa-admin-audit-actor">{event.actorId}</code>
              {event.before === undefined &&
              event.after === undefined ? null : (
                <details data-testid="qa-admin-audit-details">
                  <summary>Показать изменение</summary>
                  <pre data-testid="qa-admin-audit-diff">
                    {event.before ?? "—"}
                    {"\n→\n"}
                    {event.after ?? "—"}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      <Pager
        total={total}
        shown={rows.length}
        hasMore={cursor !== null}
        loading={loading}
        onMore={() => void load(cursor, true)}
        onReset={() => void load(null, false)}
      />
    </section>
  );
}
