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
} from "../format.js";
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
    <section className="dsh-qa-admin__page" aria-label="Обратная связь">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Обратная связь</h1>
          <p>
            Оценка пользователя — это сигнал удовлетворённости, а не измерение
            точности ответа.
          </p>
        </div>
      </div>
      <div className="dsh-qa-admin__filters">
        <FilterField label="Оценка">
          <select
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
        <FilterField label="Причина">
          <select
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
        <FilterField label="Разбор">
          <select
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
        <p className="dsh-qa-admin__empty">
          {loading ? "Загружаю…" : "Оценок пока нет."}
        </p>
      ) : (
        <table className="dsh-qa-admin__table">
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
              <tr key={row.id}>
                <td>{row.rating === "positive" ? "👍" : "👎"}</td>
                <td>{row.displayName}</td>
                <td>{row.subroleId === "" ? "—" : row.subroleId}</td>
                <td>{row.conversationTitle ?? row.conversationId}</td>
                <td>
                  {(row.reasons ?? [])
                    .map((value) => FEEDBACK_REASON_LABELS[value])
                    .join(", ") || "—"}
                  {row.comment === undefined ? null : (
                    <small>{row.comment}</small>
                  )}
                </td>
                <td>{formatStamp(row.createdAt)}</td>
                <td>
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
    () => props.api.metrics(props.token),
    [props.api, props.token],
  );
  const metrics: QaQualityMetrics | undefined = resource.data;
  return (
    <section className="dsh-qa-admin__page" aria-label="Аналитика качества">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Аналитика</h1>
          <p>
            Доли считаются по оценённым ответам. Это пользовательский сигнал, а
            не измеренная точность.
          </p>
        </div>
        <button type="button" onClick={() => void resource.reload()}>
          Обновить
        </button>
      </div>
      {resource.error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {adminErrorMessage(resource.error)}
        </p>
      )}
      {metrics === undefined ? (
        <p className="dsh-qa-admin__empty">Загружаю…</p>
      ) : (
        <>
          <dl className="dsh-qa-admin__facts dsh-qa-admin__facts--wide">
            <dt>Разговоры</dt>
            <dd>{formatCount(metrics.conversations)}</dd>
            <dt>Пользователи с разговорами</dt>
            <dd>{formatCount(metrics.activeUsers)}</dd>
            <dt>Ответы ассистента</dt>
            <dd>{formatCount(metrics.assistantMessages)}</dd>
            <dt>Оценённые ответы</dt>
            <dd>{formatCount(metrics.ratedMessages)}</dd>
            <dt>Доля оценённых</dt>
            <dd>{formatRate(metrics.ratingRate)}</dd>
            <dt>Положительных</dt>
            <dd>{formatCount(metrics.positiveRatings)}</dd>
            <dt>Негативных</dt>
            <dd>{formatCount(metrics.negativeRatings)}</dd>
            <dt>Положительная доля</dt>
            <dd>{formatRate(metrics.positiveRate)}</dd>
            <dt>Неразобранных негативных</dt>
            <dd>{formatCount(metrics.unreviewedNegatives)}</dd>
            <dt>Разобрано</dt>
            <dd>{formatCount(metrics.reviewedItems)}</dd>
          </dl>
          <section className="dsh-qa-admin__panel">
            <h2>Положительная доля по профилям</h2>
            {metrics.bySubrole.length === 0 ? (
              <p className="dsh-qa-admin__empty">Оценок по профилям нет.</p>
            ) : (
              <table className="dsh-qa-admin__table">
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
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{formatCount(row.rated)}</td>
                      <td>{formatCount(row.positive)}</td>
                      <td>{formatCount(row.negative)}</td>
                      <td>{formatRate(row.positiveRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="dsh-qa-admin__panel">
            <h2>Проблемы по вердиктам ревьюеров</h2>
            {metrics.issues.length === 0 ? (
              <p className="dsh-qa-admin__empty">Разборов пока нет.</p>
            ) : (
              <ul className="dsh-qa-admin__issues-list">
                {metrics.issues.map((row) => (
                  <li key={row.issue}>
                    <span>{row.issue}</span>
                    <strong>{formatCount(row.count)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="dsh-qa-admin__panel">
            <h2>Оценки по дням</h2>
            {metrics.trend.length === 0 ? (
              <p className="dsh-qa-admin__empty">Оценок пока нет.</p>
            ) : (
              <ul className="dsh-qa-admin__trend">
                {metrics.trend.map((point) => (
                  <li key={point.date}>
                    <span>{point.date}</span>
                    <span>👍 {formatCount(point.positive)}</span>
                    <span>👎 {formatCount(point.negative)}</span>
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
    <section className="dsh-qa-admin__page" aria-label="Аудит">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Аудит</h1>
          <p>
            Изменения доступа, назначений и разборов. Запись хранит снимок «до»
            и «после».
          </p>
        </div>
      </div>
      <div className="dsh-qa-admin__filters">
        <FilterField label="Действие">
          <select
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
        <p className="dsh-qa-admin__empty">
          {loading ? "Загружаю…" : "Изменений пока нет."}
        </p>
      ) : (
        <ol className="dsh-qa-audit">
          {rows.map((event) => (
            <li key={event.id}>
              <time title={event.timestamp}>
                {formatStamp(event.timestamp)}
              </time>
              <strong>{event.action}</strong>
              <span>{event.targetId ?? event.targetType ?? "—"}</span>
              <code>{event.actorId}</code>
              {event.before === undefined &&
              event.after === undefined ? null : (
                <details>
                  <summary>Показать изменение</summary>
                  <pre>
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
