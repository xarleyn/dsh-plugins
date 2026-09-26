import { useCallback, useEffect, useState } from "react";
import type {
  QaConversationDetail,
  QaConversationMessage,
  QaConversationQuery,
  QaConversationSummary,
  QaFeedbackRating,
  QaReviewStatus,
} from "../../../types.js";
import type { QaAdminApi } from "../../types.js";
import {
  REVIEW_STATUS_LABELS,
  TRANSCRIPT_UNAVAILABLE_LABELS,
  formatCount,
  formatDuration,
  formatStamp,
} from "../copy.js";
import {
  Badge,
  Empty,
  FilterField,
  Pager,
  Stamp,
  adminErrorMessage,
  useAdminResource,
  useRequestSlot,
} from "../shared.js";
import { ReviewPanel } from "./Review.js";

const PAGE_SIZE = 25;

/** Coarse status tone: what a triage list needs to scan at a glance. */
function statusTone(
  status: QaReviewStatus,
): "neutral" | "positive" | "negative" | "warning" {
  switch (status) {
    case "reviewed":
      return "positive";
    case "needs_followup":
      return "negative";
    case "in_review":
      return "warning";
    default:
      return "neutral";
  }
}

export function AdminConversations(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly userId?: string;
  readonly onOpenConversation: (
    conversationId: string,
    messageId?: string,
  ) => void;
}) {
  const [search, setSearch] = useState("");
  const [rating, setRating] = useState<QaFeedbackRating | "">("");
  const [reviewStatus, setReviewStatus] = useState<QaReviewStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<readonly QaConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const request = useRequestSlot();

  const load = useCallback(
    async (next: string | null, append: boolean) => {
      const controller = request.start();
      setLoading(true);
      const query: QaConversationQuery = {
        userId: props.userId ?? null,
        search: search === "" ? null : search,
        rating: rating === "" ? null : rating,
        reviewStatus: reviewStatus === "" ? null : reviewStatus,
        from: from === "" ? null : new Date(from).toISOString(),
        to: to === "" ? null : new Date(`${to}T23:59:59.999Z`).toISOString(),
      };
      const result = await props.api.conversations(
        props.token,
        query,
        next,
        PAGE_SIZE,
        controller.signal,
      );
      // A page the reviewer changed or left while this was still being read on
      // the server has no answer worth showing.
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!result.ok) {
        setError(adminErrorMessage(result.error));
        return;
      }
      setError(undefined);
      setTotal(result.value.total);
      setCursor(result.value.nextCursor);
      setRows((current) =>
        append ? [...current, ...result.value.items] : result.value.items,
      );
    },
    [
      request,
      props.api,
      props.token,
      props.userId,
      search,
      rating,
      reviewStatus,
      from,
      to,
    ],
  );

  useEffect(() => {
    void load(null, false);
  }, [load]);

  return (
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-conversations"
      aria-label="Разговоры"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Разговоры</h1>
          <p>
            {props.userId === undefined
              ? "Все разговоры стенда."
              : "Разговоры одного пользователя."}
          </p>
        </div>
      </div>
      <div
        className="dsh-qa-admin__filters"
        data-testid="qa-admin-conversations-filters"
      >
        <FilterField
          label="Поиск"
          testId="qa-admin-conversations-filter-search"
        >
          <input
            type="search"
            data-testid="qa-admin-conversations-search"
            value={search}
            placeholder="Заголовок, имя или адрес"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </FilterField>
        <FilterField
          label="Оценка"
          testId="qa-admin-conversations-filter-rating"
        >
          <select
            data-testid="qa-admin-conversations-rating"
            value={rating}
            onChange={(event) =>
              setRating(event.currentTarget.value as QaFeedbackRating | "")
            }
          >
            <option value="">Любая</option>
            <option value="positive">Есть 👍</option>
            <option value="negative">Есть 👎</option>
          </select>
        </FilterField>
        <FilterField
          label="Разбор"
          testId="qa-admin-conversations-filter-review"
        >
          <select
            data-testid="qa-admin-conversations-review-status"
            value={reviewStatus}
            onChange={(event) =>
              setReviewStatus(event.currentTarget.value as QaReviewStatus | "")
            }
          >
            <option value="">Любой</option>
            <option value="unreviewed">Не разобрано</option>
            <option value="reviewed">Разобрано</option>
            <option value="needs_followup">Нужно вернуться</option>
          </select>
        </FilterField>
        <FilterField label="С даты" testId="qa-admin-conversations-filter-from">
          <input
            type="date"
            data-testid="qa-admin-conversations-from"
            value={from}
            onChange={(event) => setFrom(event.currentTarget.value)}
          />
        </FilterField>
        <FilterField label="По дату" testId="qa-admin-conversations-filter-to">
          <input
            type="date"
            data-testid="qa-admin-conversations-to"
            value={to}
            onChange={(event) => setTo(event.currentTarget.value)}
          />
        </FilterField>
      </div>
      {error === undefined ? null : (
        <p
          className="dsh-qa-admin__error"
          data-testid="qa-admin-conversations-error"
          role="alert"
        >
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p
          className="dsh-qa-admin__empty"
          data-testid="qa-admin-conversations-empty"
        >
          {loading ? "Загружаю…" : "Ничего не нашлось."}
        </p>
      ) : (
        <table
          className="dsh-qa-admin__table"
          data-testid="qa-admin-conversations-table"
        >
          <thead>
            <tr>
              <th>Разговор</th>
              <th>Пользователь</th>
              <th>Профиль</th>
              <th>Начат</th>
              <th>Активность</th>
              <th>Сообщения</th>
              <th>Оценки</th>
              <th>Разбор</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.conversationId}
                data-testid="qa-admin-conversations-row"
              >
                <td data-testid="qa-admin-conversations-cell-title">
                  <strong>{row.title ?? "Без заголовка"}</strong>
                  <small>{row.conversationId}</small>
                </td>
                <td>{row.displayName}</td>
                <td>{row.subroleId === "" ? "—" : row.subroleId}</td>
                <td>{formatStamp(row.createdAt)}</td>
                <td>
                  <Stamp value={row.updatedAt} />
                </td>
                <td>{formatCount(row.messageCount)}</td>
                <td>
                  👍 {formatCount(row.positiveFeedback)} · 👎{" "}
                  {formatCount(row.negativeFeedback)}
                </td>
                <td data-testid="qa-admin-conversations-cell-review">
                  <Badge tone={statusTone(row.reviewStatus)}>
                    {REVIEW_STATUS_LABELS[row.reviewStatus]}
                  </Badge>
                </td>
                <td>
                  <button
                    type="button"
                    data-testid="qa-admin-conversations-open"
                    onClick={() => props.onOpenConversation(row.conversationId)}
                  >
                    Открыть
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

/**
 * The review viewer: the conversation as it happened, next to the reviewer's
 * form. Tool calls collapse by default — a reviewer looking for "the tool
 * failed" should not have to scroll past every argument to find it.
 */
export function AdminConversation(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly conversationId: string;
  readonly messageId?: string;
  readonly canReview: boolean;
  /** Removing the conversation itself belongs to the administrator alone. */
  readonly canDelete: boolean;
  readonly onBack: () => void;
  /** Called once the conversation is gone, so the console leaves the page. */
  readonly onDeleted?: () => void;
}) {
  const resource = useAdminResource(
    () => props.api.conversation(props.token, props.conversationId),
    [props.api, props.token, props.conversationId],
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const detail = resource.data;

  const remove = useCallback(async () => {
    // Deleting removes the chat itself, its subagent sessions and everything
    // the QA layer recorded about it — not the row the sidebar's own delete
    // hides — so the confirmation has to say which one this is.
    const confirmed = window.confirm(
      "Удалить разговор со стенда? Он сам, его служебные сессии, оценки и разбор будут удалены без возможности восстановления.",
    );
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await props.api.deleteConversation(
        props.token,
        props.conversationId,
      );
      if (!result.ok) {
        setDeleteError(adminErrorMessage(result.error));
        return;
      }
      props.onDeleted?.();
    } catch (error) {
      setDeleteError(adminErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }, [props.api, props.token, props.conversationId, props.onDeleted]);

  if (resource.error !== undefined) {
    return (
      <section
        className="dsh-qa-admin__page"
        data-testid="qa-admin-conversation"
      >
        <p
          className="dsh-qa-admin__error"
          data-testid="qa-admin-conversation-error"
          role="alert"
        >
          {adminErrorMessage(resource.error)}
        </p>
        <button
          type="button"
          data-testid="qa-admin-conversation-back"
          onClick={props.onBack}
        >
          К списку
        </button>
      </section>
    );
  }
  if (detail === undefined) {
    return (
      <section
        className="dsh-qa-admin__page"
        data-testid="qa-admin-conversation"
      >
        <p
          className="dsh-qa-admin__empty"
          data-testid="qa-admin-conversation-loading"
        >
          Загружаю разговор…
        </p>
      </section>
    );
  }
  return (
    <section
      className="dsh-qa-admin__page"
      data-testid="qa-admin-conversation"
      aria-label="Разговор"
    >
      <div className="dsh-qa-admin__title-row">
        <div>
          <button
            type="button"
            data-testid="qa-admin-conversation-back"
            onClick={props.onBack}
          >
            ← Разговоры
          </button>
          <h1>{detail.summary.title ?? "Без заголовка"}</h1>
          <p>
            {detail.summary.displayName} ·{" "}
            {detail.runtime.subroleId === ""
              ? "профиль неизвестен"
              : detail.runtime.subroleId}{" "}
            · {formatStamp(detail.summary.createdAt)}
            {detail.runtime.model === undefined
              ? ""
              : ` · ${detail.runtime.provider ?? ""} ${detail.runtime.model}`}
            {detail.runtime.agentPreset === undefined
              ? ""
              : ` · пресет ${detail.runtime.agentPreset}`}
            {detail.runtime.adminPreview ? " · предпросмотр роли" : ""}
          </p>
        </div>
        {props.canDelete ? (
          <div className="dsh-qa-admin__title-actions">
            <button
              type="button"
              data-testid="qa-admin-conversation-delete"
              className="dsh-qa-admin__danger"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? "Удаляю…" : "Удалить разговор"}
            </button>
            {deleteError === undefined ? null : (
              <p
                className="dsh-qa-admin__error"
                data-testid="qa-admin-conversation-delete-error"
                role="alert"
              >
                {deleteError}
              </p>
            )}
          </div>
        ) : null}
      </div>
      <div className="dsh-qa-admin__conversation">
        <div
          className="dsh-qa-admin__transcript"
          data-testid="qa-admin-conversation-transcript"
        >
          {detail.runtime.transcriptUnavailable === undefined ? null : (
            <p
              className="dsh-qa-admin__error"
              data-testid="qa-admin-conversation-transcript-error"
              role="alert"
            >
              {
                TRANSCRIPT_UNAVAILABLE_LABELS[
                  detail.runtime.transcriptUnavailable
                ]
              }
            </p>
          )}
          <RuntimeFacts detail={detail} />
          {detail.messages.length === 0 ? (
            <Empty testId="qa-admin-conversation-transcript-empty">
              Сообщений нет — разговор мог быть создан и не начат.
            </Empty>
          ) : (
            detail.messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                highlighted={message.id === props.messageId}
              />
            ))
          )}
        </div>
        <ReviewPanel
          api={props.api}
          token={props.token}
          detail={detail}
          canReview={props.canReview}
          onSaved={() => void resource.reload()}
        />
      </div>
    </section>
  );
}

function RuntimeFacts(props: { readonly detail: QaConversationDetail }) {
  const { runtime, summary } = props.detail;
  const tools = runtime.effectiveTools ?? [];
  const skills = runtime.effectiveSkills ?? [];
  const loaded = runtime.loadedSkills ?? [];
  return (
    <section
      className="dsh-qa-admin__runtime"
      data-testid="qa-admin-conversation-runtime"
    >
      <h2>Что было доступно тогда</h2>
      <dl
        className="dsh-qa-admin__facts"
        data-testid="qa-admin-conversation-facts"
      >
        <dt>Отправлено</dt>
        <dd>{formatStamp(summary.createdAt)}</dd>
        <dt>Последняя активность</dt>
        <dd>{formatStamp(summary.updatedAt)}</dd>
        <dt>Инструменты</dt>
        <dd data-testid="qa-admin-conversation-tool-count">
          {tools.length === 0
            ? "снимок не сохранён"
            : `${formatCount(tools.length)}`}
        </dd>
        <dt>Навыки</dt>
        <dd data-testid="qa-admin-conversation-skill-count">
          {skills.length === 0
            ? "снимок не сохранён"
            : formatCount(skills.length)}
        </dd>
        <dt>Загруженные навыки</dt>
        <dd data-testid="qa-admin-conversation-loaded-skills">
          {loaded.length === 0 ? "—" : loaded.join(", ")}
        </dd>
      </dl>
      {tools.length === 0 ? null : (
        <details data-testid="qa-admin-conversation-tools">
          <summary>Инструменты разговора ({tools.length})</summary>
          <p
            className="dsh-qa-admin__mono"
            data-testid="qa-admin-conversation-tools-list"
          >
            {tools.join(", ")}
          </p>
        </details>
      )}
      {skills.length === 0 ? null : (
        <details data-testid="qa-admin-conversation-skills">
          <summary>Навыки разговора ({skills.length})</summary>
          <p
            className="dsh-qa-admin__mono"
            data-testid="qa-admin-conversation-skills-list"
          >
            {skills.join(", ")}
          </p>
        </details>
      )}
    </section>
  );
}

function MessageRow(props: {
  readonly message: QaConversationMessage;
  readonly highlighted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { message } = props;
  const feedback = message.feedback ?? [];
  const reviews = message.reviews ?? [];
  return (
    <article
      className={`dsh-qa-admin__message dsh-qa-admin__message--${message.role}${
        props.highlighted ? " dsh-qa-admin__message--highlighted" : ""
      }`}
      data-testid="qa-admin-message"
      id={`message-${message.id}`}
    >
      <header data-testid="qa-admin-message-head">
        <strong data-testid="qa-admin-message-role">
          {message.role === "user"
            ? "Пользователь"
            : message.role === "assistant"
              ? "Ассистент"
              : "Система"}
        </strong>
        <time title={String(message.time)}>
          {formatStamp(new Date(message.time).toISOString())}
        </time>
        {message.model === undefined ? null : (
          <span
            className="dsh-qa-admin__mono"
            data-testid="qa-admin-message-model"
          >
            {message.model}
          </span>
        )}
        {message.interrupted === true ? (
          <Badge tone="warning" testId="qa-admin-message-interrupted">
            Прерван
          </Badge>
        ) : null}
        {message.usage === undefined ? null : (
          <span
            className="dsh-qa-admin__usage"
            data-testid="qa-admin-message-usage"
          >
            {formatCount(message.usage.inputTokens)} →{" "}
            {formatCount(message.usage.outputTokens)} токенов
          </span>
        )}
        {feedback.map((row) => (
          <Badge
            key={row.id}
            testId="qa-admin-message-feedback"
            tone={row.rating === "positive" ? "positive" : "negative"}
          >
            {row.rating === "positive" ? "👍" : "👎"}
            {row.reasons === undefined || row.reasons.length === 0
              ? ""
              : ` ${row.reasons.length}`}
          </Badge>
        ))}
        {reviews.length === 0 ? null : (
          <Badge tone="neutral" testId="qa-admin-message-review">
            разобрано: {reviews[0]?.severity}
          </Badge>
        )}
      </header>
      <p
        className="dsh-qa-admin__message-text"
        data-testid="qa-admin-message-text"
      >
        {message.text === "" ? "(пустой текст)" : message.text}
      </p>
      {feedback.map((row) =>
        row.comment === undefined ? null : (
          <p
            key={`${row.id}:comment`}
            className="dsh-qa-admin__comment"
            data-testid="qa-admin-message-comment"
          >
            Комментарий: {row.comment}
          </p>
        ),
      )}
      {(message.toolCalls ?? []).length === 0 ? null : (
        <div
          className="dsh-qa-admin__tools"
          data-testid="qa-admin-message-tools"
        >
          <button
            type="button"
            data-testid="qa-admin-message-tools-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {/* Inline chevron, never a font glyph: its shape and baseline
                would follow whatever font the page happens to use. */}
            <svg
              className={`dsh-qa-admin__disclosure${
                open ? " dsh-qa-admin__disclosure--open" : ""
              }`}
              viewBox="0 0 14 14"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                d="m3.5 5.25 3.5 3.5 3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            вызовы инструментов ({(message.toolCalls ?? []).length})
          </button>
          {open ? (
            <ol data-testid="qa-admin-message-tool-list">
              {(message.toolCalls ?? []).map((call) => (
                <li key={call.callId} data-testid="qa-admin-message-tool">
                  <strong
                    className="dsh-qa-admin__mono"
                    data-testid="qa-admin-message-tool-name"
                  >
                    {call.name}
                  </strong>
                  {call.error === undefined ? null : (
                    <Badge tone="negative" testId="qa-admin-message-tool-error">
                      сбой: {call.error}
                    </Badge>
                  )}
                  {call.durationMs === undefined ? null : (
                    <span>{formatDuration(call.durationMs)}</span>
                  )}
                  <pre data-testid="qa-admin-message-tool-args">
                    {call.arguments}
                  </pre>
                  {call.result === undefined ? null : (
                    <pre data-testid="qa-admin-message-tool-result">
                      {call.result}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </article>
  );
}
