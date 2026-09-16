import { useState } from "react";
import type {
  QaConversationDetail,
  QaConversationReviewInput,
  QaQualityIssueType,
  QaQualitySeverity,
  QaRemediationTarget,
  QaReviewQueueRow,
} from "../../../types.js";
import type { QaAdminApi } from "../../types.js";
import {
  ISSUE_GROUPS,
  ISSUE_LABELS,
  REVIEW_PRIORITY_LABELS,
  REVIEW_REASON_LABELS,
  SEVERITY_LABELS,
  TARGET_LABELS,
  formatStamp,
} from "../copy.js";
import {
  Badge,
  FilterField,
  Pager,
  adminErrorMessage,
  useAdminResource,
} from "../shared.js";

/**
 * The review form and its queue.
 *
 * A verdict here is the reviewer's own judgement, deliberately kept apart from
 * the user's thumbs: the reviewer answers "does this match our quality bar",
 * the user answered "was this useful to me". Both are stored against the exact
 * message, and neither rewrites the other.
 */

const PAGE_SIZE = 20;

export function AdminReviewQueue(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly onOpenConversation: (
    conversationId: string,
    messageId?: string,
  ) => void;
}) {
  const [rows, setRows] = useState<readonly QaReviewQueueRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const load = async (next: string | null, append: boolean) => {
    const result = await props.api.reviewQueue(props.token, next, PAGE_SIZE);
    if (!result.ok) return;
    setTotal(result.value.total);
    setCursor(result.value.nextCursor);
    setRows((current) =>
      append ? [...current, ...result.value.items] : result.value.items,
    );
  };

  const resource = useAdminResource(
    () => props.api.reviewQueue(props.token, null, PAGE_SIZE),
    [props.api, props.token],
  );
  const items = resource.data?.items ?? rows;

  return (
    <section className="dsh-qa-admin__page" aria-label="Очередь разбора">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Очередь разбора</h1>
          <p>
            Разговоры, требующие внимания: негативные оценки, ручные запросы и
            сбои инструментов. Разобранный пункт уходит из очереди.
          </p>
        </div>
      </div>
      {resource.error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {adminErrorMessage(resource.error)}
        </p>
      )}
      {items.length === 0 ? (
        <p className="dsh-qa-admin__empty">
          {resource.loading ? "Загружаю…" : "Очередь пуста."}
        </p>
      ) : (
        <ul className="dsh-qa-admin__queue">
          {items.map((row, index) => (
            <li
              key={`${row.conversationId}:${row.messageId ?? ""}:${index}`}
              className={`dsh-qa-admin__queue-item dsh-qa-admin__queue-item--${row.priority}`}
            >
              <div className="dsh-qa-admin__queue-head">
                <span className="dsh-qa-admin__queue-priority">
                  {REVIEW_PRIORITY_LABELS[row.priority]}
                </span>
                <span>{REVIEW_REASON_LABELS[row.reason]}</span>
                <Badge
                  tone={row.status === "reviewed" ? "positive" : "neutral"}
                >
                  {row.status === "reviewed"
                    ? "Разобрано"
                    : row.status === "needs_followup"
                      ? "Нужно вернуться"
                      : "Не разобрано"}
                </Badge>
                <time title={row.raisedAt}>{formatStamp(row.raisedAt)}</time>
              </div>
              <button
                type="button"
                onClick={() =>
                  props.onOpenConversation(row.conversationId, row.messageId)
                }
              >
                {row.title ?? row.conversationId}
              </button>
              <span className="dsh-qa-admin__queue-owner">
                {row.displayName}
                {row.subroleId === "" ? "" : ` · ${row.subroleId}`}
              </span>
              {row.issueSummary === undefined ? null : (
                <p className="dsh-qa-admin__queue-issues">
                  {row.issueSummary
                    .map((issue) => ISSUE_LABELS[issue])
                    .join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager
        total={resource.data?.total ?? total}
        shown={items.length}
        hasMore={(resource.data?.nextCursor ?? cursor) !== null}
        loading={resource.loading}
        onMore={() => void load(resource.data?.nextCursor ?? cursor, true)}
        onReset={() => void resource.reload()}
      />
    </section>
  );
}

const SEVERITIES: readonly QaQualitySeverity[] = ["minor", "major", "critical"];

export function ReviewPanel(props: {
  readonly api: QaAdminApi;
  readonly token: string;
  readonly detail: QaConversationDetail;
  readonly canReview: boolean;
  readonly onSaved: () => void;
}) {
  const [status, setStatus] = useState<"reviewed" | "needs_followup">(
    "reviewed",
  );
  const [issues, setIssues] = useState<readonly QaQualityIssueType[]>([]);
  const [severity, setSeverity] = useState<QaQualitySeverity>("minor");
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState<QaRemediationTarget | "">("");
  const [suggestedAction, setSuggestedAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [queued, setQueued] = useState(false);

  const toggleIssue = (issue: QaQualityIssueType): void => {
    setIssues((current) =>
      current.includes(issue)
        ? current.filter((value) => value !== issue)
        : [...current, issue],
    );
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    const input: QaConversationReviewInput = {
      conversationId: props.detail.conversationId,
      status,
      issues,
      severity,
      ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
      ...(target === "" ? {} : { target }),
      ...(suggestedAction.trim() === ""
        ? {}
        : { suggestedAction: suggestedAction.trim() }),
    };
    const result = await props.api.saveReview(props.token, input);
    setBusy(false);
    if (!result.ok) {
      setError(adminErrorMessage(result.error));
      return;
    }
    setError(undefined);
    setNotes("");
    setSuggestedAction("");
    props.onSaved();
  };

  const queueIt = async (): Promise<void> => {
    setBusy(true);
    const result = await props.api.queueConversation(
      props.token,
      props.detail.conversationId,
      null,
    );
    setBusy(false);
    if (!result.ok) {
      setError(adminErrorMessage(result.error));
      return;
    }
    setQueued(true);
    props.onSaved();
  };

  return (
    <aside className="dsh-qa-admin__review" aria-label="Разбор разговора">
      <h2>Разбор</h2>
      {error === undefined ? null : (
        <p className="dsh-qa-admin__error" role="alert">
          {error}
        </p>
      )}
      {props.detail.reviews.length === 0 ? null : (
        <ul className="dsh-qa-admin__reviews">
          {props.detail.reviews.map((review) => (
            <li key={review.id}>
              <div>
                <Badge
                  tone={review.status === "reviewed" ? "positive" : "negative"}
                >
                  {review.status === "reviewed"
                    ? "Разобрано"
                    : "Нужно вернуться"}
                </Badge>
                <span>{SEVERITY_LABELS[review.severity]}</span>
                <time title={review.createdAt}>
                  {formatStamp(review.createdAt)}
                </time>
              </div>
              {review.issues.length === 0 ? null : (
                <p>
                  {review.issues.map((issue) => ISSUE_LABELS[issue]).join(", ")}
                </p>
              )}
              {review.notes === undefined ? null : <p>{review.notes}</p>}
              {review.target === undefined ? null : (
                <p>
                  Причина: {TARGET_LABELS[review.target]}
                  {review.suggestedAction === undefined
                    ? ""
                    : ` — ${review.suggestedAction}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.canReview ? (
        <>
          <FilterField label="Статус">
            <select
              value={status}
              onChange={(event) =>
                setStatus(
                  event.currentTarget.value as "reviewed" | "needs_followup",
                )
              }
            >
              <option value="reviewed">Разобрано</option>
              <option value="needs_followup">Нужно вернуться</option>
            </select>
          </FilterField>
          <fieldset className="dsh-qa-admin__issues">
            <legend>Проблемы</legend>
            {ISSUE_GROUPS.map((group) => (
              <div key={group.title}>
                <h4>{group.title}</h4>
                {group.issues.map((issue) => (
                  <label key={issue}>
                    <input
                      type="checkbox"
                      checked={issues.includes(issue)}
                      onChange={() => toggleIssue(issue)}
                    />
                    {ISSUE_LABELS[issue]}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          <FilterField label="Важность">
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.currentTarget.value as QaQualitySeverity)
              }
            >
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {SEVERITY_LABELS[value]}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Куда направить исправление">
            <select
              value={target}
              onChange={(event) =>
                setTarget(event.currentTarget.value as QaRemediationTarget | "")
              }
            >
              <option value="">Не указано</option>
              {(Object.keys(TARGET_LABELS) as QaRemediationTarget[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {TARGET_LABELS[value]}
                  </option>
                ),
              )}
            </select>
          </FilterField>
          <FilterField label="Что сделать">
            <input
              type="text"
              value={suggestedAction}
              onChange={(event) =>
                setSuggestedAction(event.currentTarget.value)
              }
              placeholder="Например: добавить регламент в базу знаний"
            />
          </FilterField>
          <FilterField label="Заметки">
            <textarea
              value={notes}
              rows={4}
              onChange={(event) => setNotes(event.currentTarget.value)}
            />
          </FilterField>
          <div className="dsh-qa-admin__actions">
            <button
              type="button"
              className="dsh-qa-admin__primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Сохранить разбор
            </button>
            <button
              type="button"
              disabled={busy || queued}
              onClick={() => void queueIt()}
            >
              {queued ? "В очереди" : "Отправить на разбор"}
            </button>
          </div>
        </>
      ) : (
        <p className="dsh-qa-admin__empty">
          Классифицировать разговоры может только ревьюер или администратор.
        </p>
      )}
    </aside>
  );
}
