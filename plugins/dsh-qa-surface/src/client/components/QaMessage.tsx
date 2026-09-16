import { memo, useEffect, useRef, useState } from "react";
import type {
  QaFileView,
  QaMessage as QaMessageModel,
  QaImageView,
  QaSource,
  QaTurnSources,
} from "../../types.js";
import { sameWorkItems } from "./QaWorkGroup.js";
import { QaFileAttachment } from "./QaFileAttachment.js";
import { buildSourceRefs, type QaSourceRefs } from "./source-refs.js";

function QaAttachedImage({
  image,
  resolve,
}: {
  readonly image: QaImageView;
  readonly resolve?: (attachmentId: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(image.previewUrl ?? null);
  useEffect(() => {
    if (image.previewUrl !== undefined) {
      setUrl(image.previewUrl);
      return;
    }
    if (resolve === undefined) {
      setUrl("");
      return;
    }
    let alive = true;
    // Deduplication and revocation live in the controller's per-chat asset
    // repository; this effect only projects one resolution.
    resolve(image.attachmentId).then(
      (resolved) => {
        if (alive) setUrl(resolved);
      },
      () => {
        if (alive) setUrl("");
      },
    );
    return () => {
      alive = false;
    };
  }, [image.attachmentId, image.previewUrl, resolve]);
  if (url === null) {
    return <span className="dsh-qa-message__image" data-state="loading" />;
  }
  if (url === "") {
    return <span className="dsh-qa-message__image" data-state="broken" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        className="dsh-qa-message__image"
        src={url}
        alt="Прикреплённое изображение"
      />
    </a>
  );
}
import type { QaFeedbackReason } from "../../types.js";
import { FEEDBACK_REASON_LABELS } from "../admin/copy.js";
import { formatDayTime, formatSeconds } from "./format.js";
import { Markdown } from "./Markdown.js";
import { QaWorkGroup } from "./QaWorkGroup.js";

export interface QaMessageProps {
  readonly message: QaMessageModel;
  readonly renderMarkdown: boolean;
  readonly showTimestamp: boolean;
  /**
   * Storage prefix persisted message ratings live under. Callers scope it to
   * the chat: message ids repeat across chats (`assistant:<seq>`).
   */
  readonly stateKey?: string;
  /** Ask for a fresh variant of this answer; omit to hide the control. */
  readonly onRegenerate?: () => void;
  /** Resolve one durable attachment into a viewable URL. */
  readonly resolveImage?: (attachmentId: string) => Promise<string>;
  /** Open the drawer at the exact canonical snapshot shown in this footer. */
  readonly onOpenSources?: (
    sources: readonly QaSource[],
    complete: boolean,
    incompleteOrigins: QaTurnSources["incompleteOrigins"],
  ) => void;
  /** Open one path-backed source's detail (an inline footnote click). */
  readonly onSourceDetail?: (source: QaSource) => void;
  /** Operator-configured running phrases; omitted reads the built-in list. */
  readonly thinkingPhrases?: readonly string[];
  /**
   * Persist a rating for this answer. Omitted on a surface with no accounts or
   * no durable message identity: the control then only records the choice
   * locally, which is what the standalone QA surface has always done.
   */
  readonly onRateFeedback?: (input: {
    /** Durable log position of this answer, when the transcript knows it. */
    readonly messageId?: number;
    readonly rating: "positive" | "negative";
    readonly reasons?: readonly QaFeedbackReason[];
    readonly comment?: string;
  }) => void;
}

type Rating = "up" | "down";

/**
 * Whether two transcript messages render identically. The transcript
 * projection rebuilds every message object on each published frame, so the
 * memoized row compares rendered content instead of references; string
 * comparison is by value, which keeps fresh copies cheap to recognize.
 */
export function sameMessage(a: QaMessageModel, b: QaMessageModel): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.role !== b.role || a.status !== b.status) return false;
  if (a.role === "work" && b.role === "work") {
    return (
      a.turn === b.turn &&
      a.startedAt === b.startedAt &&
      a.endedAt === b.endedAt &&
      sameWorkItems(a.items, b.items)
    );
  }
  if (a.role === "work" || b.role === "work") return false;
  // Roles are equal, so both messages are one of the text-bearing variants.
  if (a.text !== b.text || a.timestamp !== b.timestamp) return false;
  if (a.role === "assistant" && b.role === "assistant") {
    return (
      sameSources(a.sources, b.sources) &&
      (a.stats === undefined) === (b.stats === undefined) &&
      (a.stats === undefined ||
        b.stats === undefined ||
        (a.stats.durationMs === b.stats.durationMs &&
          a.stats.ttftMs === b.stats.ttftMs &&
          a.stats.tokensPerSecond === b.stats.tokensPerSecond))
    );
  }
  if (a.role === "user" && b.role === "user") {
    return (
      a.author === b.author &&
      sameImages(a.images, b.images) &&
      sameFiles(a.files, b.files)
    );
  }
  if (a.role === "system" && b.role === "system") {
    return (
      (a.notice === undefined) === (b.notice === undefined) &&
      (a.notice === undefined ||
        b.notice === undefined ||
        (a.notice.title === b.notice.title &&
          a.notice.body === b.notice.body &&
          a.notice.meta === b.notice.meta))
    );
  }
  return false;
}

function sameSources(
  a: readonly QaSource[] | undefined,
  b: readonly QaSource[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (source, index) =>
      source.id === b[index]?.id &&
      source.title === b[index]?.title &&
      source.uri === b[index]?.uri &&
      source.path === b[index]?.path &&
      source.snippet === b[index]?.snippet &&
      source.evidence === b[index]?.evidence &&
      source.score === b[index]?.score &&
      JSON.stringify(source.locations) ===
        JSON.stringify(b[index]?.locations) &&
      JSON.stringify(source.origins) === JSON.stringify(b[index]?.origins),
  );
}

function sameImages(
  a: readonly QaImageView[] | undefined,
  b: readonly QaImageView[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (image, index) =>
      image.attachmentId === (b[index] as QaImageView).attachmentId &&
      image.mediaType === (b[index] as QaImageView).mediaType &&
      image.previewUrl === (b[index] as QaImageView).previewUrl,
  );
}

function sameFiles(
  a: readonly QaFileView[] | undefined,
  b: readonly QaFileView[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (file, index) =>
      file.attachmentId === (b[index] as QaFileView).attachmentId &&
      file.name === (b[index] as QaFileView).name &&
      file.bytes === (b[index] as QaFileView).bytes,
  );
}

const REASONS: readonly QaFeedbackReason[] = [
  "incorrect",
  "instruction_not_followed",
  "missing_information",
  "outdated_information",
  "tool_issue",
  "too_verbose",
  "too_short",
  "other",
];

/**
 * "What went wrong?" — optional detail on a down-vote.
 *
 * The rating is already recorded by the time this renders, so both buttons let
 * the user out immediately: an unanswered survey costs a rating, and a rating
 * lost is a quality signal lost.
 */
function FeedbackReasonForm(props: {
  readonly onSubmit: (
    reasons: readonly QaFeedbackReason[],
    comment: string,
  ) => void;
  readonly onSkip: () => void;
}) {
  const [reasons, setReasons] = useState<readonly QaFeedbackReason[]>([]);
  const [comment, setComment] = useState("");
  return (
    <form
      className="dsh-qa-feedback"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit(reasons, comment);
      }}
    >
      <strong>Что пошло не так?</strong>
      <div className="dsh-qa-feedback__reasons">
        {REASONS.map((reason) => (
          <label key={reason}>
            <input
              type="checkbox"
              checked={reasons.includes(reason)}
              onChange={() =>
                setReasons((current) =>
                  current.includes(reason)
                    ? current.filter((value) => value !== reason)
                    : [...current, reason],
                )
              }
            />
            {FEEDBACK_REASON_LABELS[reason]}
          </label>
        ))}
      </div>
      <textarea
        value={comment}
        rows={2}
        placeholder="Комментарий (необязательно)"
        onChange={(event) => setComment(event.currentTarget.value)}
      />
      <div className="dsh-qa-feedback__actions">
        <button type="submit">Отправить</button>
        <button type="button" onClick={props.onSkip}>
          Пропустить
        </button>
      </div>
    </form>
  );
}

function readRatings(stateKey: string | undefined): Record<string, Rating> {
  if (stateKey === undefined) return {};
  try {
    const raw = window.localStorage.getItem(`${stateKey}:ratings`);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, Rating>)
      : {};
  } catch {
    return {};
  }
}

function writeRating(
  stateKey: string | undefined,
  id: string,
  rating: Rating | null,
): void {
  if (stateKey === undefined) return;
  try {
    const ratings = readRatings(stateKey);
    if (rating === null) delete ratings[id];
    else ratings[id] = rating;
    window.localStorage.setItem(`${stateKey}:ratings`, JSON.stringify(ratings));
  } catch {
    // A denied localStorage write must not break the conversation.
  }
}

function assistantMeta(message: QaMessageModel & { role: "assistant" }) {
  const parts: string[] = [];
  if (message.stats !== undefined) {
    parts.push(formatSeconds(message.stats.durationMs));
    if (message.stats.ttftMs !== null) {
      parts.push(`TTFT ${formatSeconds(message.stats.ttftMs)}`);
    }
    if (message.stats.tokensPerSecond !== null) {
      parts.push(`${message.stats.tokensPerSecond} ток/с`);
    }
  }
  return parts;
}

export const QaMessage = memo(
  function QaMessage({
    message,
    renderMarkdown,
    showTimestamp,
    stateKey,
    onRegenerate,
    resolveImage,
    onOpenSources,
    onSourceDetail,
    thinkingPhrases,
    onRateFeedback,
  }: QaMessageProps) {
    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
    const [rating, setRating] = useState<Rating | null>(null);
    // The negative flow asks why, once, without blocking the rating itself.
    const [askingWhy, setAskingWhy] = useState(false);
    // Source-footnote registry, cached by the source-id set so the memoized
    // Markdown keeps one resolver identity across streaming frames.
    const refsCache = useRef<{ ids: string; refs: QaSourceRefs }>({
      ids: "",
      refs: buildSourceRefs([]),
    });
    if (message.role === "assistant") {
      const ids = message.sources?.map((source) => source.id).join("|") ?? "";
      if (refsCache.current.ids !== ids) {
        refsCache.current = {
          ids,
          refs: buildSourceRefs(message.sources ?? []),
        };
      }
    }
    const sourceRefs =
      message.role === "assistant" ? refsCache.current.refs : undefined;
    useEffect(() => {
      setRating(readRatings(stateKey)[message.id] ?? null);
    }, [stateKey, message.id]);
    useEffect(
      () => () => {
        if (copiedTimer.current !== undefined)
          clearTimeout(copiedTimer.current);
      },
      [],
    );
    if (message.role === "system" && message.notice !== undefined) {
      return (
        <details className="dsh-qa-notice">
          <summary className="dsh-qa-notice__summary">
            <svg
              className="dsh-qa-notice__icon"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="10" height="7.5" rx="1.75" />
              <path d="M8 2.5V5m0-.25a.9.9 0 1 0-.01-1.8.9.9 0 0 0 .01 1.8ZM5.4 8.4h1.7M8.9 8.4h1.7M6 10.4h4" />
            </svg>
            <span className="dsh-qa-notice__title">{message.notice.title}</span>
            <svg
              className="dsh-qa-notice__chevron"
              viewBox="0 0 14 14"
              aria-hidden="true"
            >
              <path d="m5.25 3.5 3.5 3.5-3.5 3.5" />
            </svg>
          </summary>
          <div className="dsh-qa-notice__body">
            {message.notice.meta === undefined ? null : (
              <p className="dsh-qa-notice__meta">{message.notice.meta}</p>
            )}
            {message.notice.body === "" ? (
              <p>Без итогового сообщения.</p>
            ) : renderMarkdown ? (
              <Markdown text={message.notice.body} />
            ) : (
              message.notice.body
            )}
          </div>
        </details>
      );
    }
    if (message.role === "work") {
      return (
        <article
          className="dsh-qa-message dsh-qa-message--work"
          data-status={message.status}
          aria-label="Работа помощника"
        >
          <QaWorkGroup
            status={message.status}
            startedAt={message.startedAt}
            endedAt={message.endedAt}
            items={message.items}
            renderMarkdown={renderMarkdown}
            thinkingPhrases={thinkingPhrases}
          />
        </article>
      );
    }
    const label =
      message.role === "assistant"
        ? "Помощник"
        : message.role === "user"
          ? (message.author ?? "Вы")
          : "Статус";
    const copy = async () => {
      if (copied || navigator.clipboard?.writeText === undefined) return;
      try {
        await navigator.clipboard.writeText(message.text);
        setCopied(true);
        if (copiedTimer.current !== undefined)
          clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1200);
      } catch {
        // Clipboard access may be denied by the embedding browser; keep the
        // action available for a later user gesture without surfacing noise.
      }
    };
    const persist = (
      next: Rating | null,
      detail?: {
        readonly reasons?: readonly QaFeedbackReason[];
        readonly comment?: string;
      },
    ) => {
      if (next === null || onRateFeedback === undefined) return;
      if (message.role !== "assistant" || message.seq === undefined) {
        // The thumbs state is already written, so a rating the Host cannot key
        // to a log position would otherwise look filed while never leaving the
        // browser — say so instead of losing it quietly.
        console.warn(
          "QA feedback was not sent: this answer carries no durable log position.",
        );
        return;
      }
      onRateFeedback({
        messageId: message.seq,
        rating: next === "up" ? "positive" : "negative",
        ...(detail?.reasons === undefined ? {} : { reasons: detail.reasons }),
        ...(detail?.comment === undefined ? {} : { comment: detail.comment }),
      });
    };
    const toggleRating = (value: Rating) => {
      const next = rating === value ? null : value;
      setRating(next);
      writeRating(stateKey, message.id, next);
      // The reason form only opens where a rating can actually be stored: an
      // answer nobody persists has no reviewer to inform.
      if (value === "down" && next === "down" && onRateFeedback !== undefined) {
        setAskingWhy(true);
        return;
      }
      setAskingWhy(false);
      persist(next);
    };
    const persistentMeta = showTimestamp && message.timestamp !== undefined;
    const meta =
      message.role === "system" || message.timestamp === undefined ? null : (
        <span className="dsh-qa-message__meta">
          <time dateTime={new Date(message.timestamp).toISOString()}>
            {formatDayTime(message.timestamp)}
          </time>
          {message.role === "assistant"
            ? assistantMeta(message).map((part) => (
                <span key={part} className="dsh-qa-message__meta-part">
                  {part}
                </span>
              ))
            : null}
        </span>
      );
    const showActions =
      message.role !== "system" &&
      message.status !== "streaming" &&
      message.status !== "pending";
    return (
      <article
        className={`dsh-qa-message dsh-qa-message--${message.role}`}
        data-status={message.status}
        aria-label={`Сообщение: ${label}`}
      >
        <div className="dsh-qa-message__content">
          {message.role === "user" && message.author !== undefined ? (
            <span className="dsh-qa-message__byline">{message.author}</span>
          ) : null}
          {message.role === "user" && message.files !== undefined ? (
            <div
              className="dsh-qa-message__files"
              aria-label="Прикреплённые файлы"
            >
              {message.files.map((file) => (
                <QaFileAttachment
                  key={file.attachmentId}
                  name={file.name}
                  bytes={file.bytes}
                  tone="sent"
                />
              ))}
            </div>
          ) : null}
          {message.role === "user" && message.images !== undefined ? (
            <div className="dsh-qa-message__images">
              {message.images.map((image) => (
                <QaAttachedImage
                  key={image.attachmentId}
                  image={image}
                  resolve={resolveImage}
                />
              ))}
            </div>
          ) : null}
          {message.role === "assistant" && renderMarkdown ? (
            <Markdown
              text={message.text}
              sourceRefs={sourceRefs}
              onSourceOpen={onSourceDetail}
            />
          ) : (
            message.text
          )}
          {message.status === "streaming" ? (
            <span className="dsh-qa-message__cursor" aria-hidden="true" />
          ) : null}
        </div>
        {message.role === "user" && message.status === "pending" ? (
          <span className="dsh-qa-message__pending" role="status">
            <span
              className="dsh-qa-message__pending-spinner"
              aria-hidden="true"
            />
            Подготавливаю ответ…
          </span>
        ) : null}
        {message.role === "assistant" &&
        onOpenSources !== undefined &&
        message.sources !== undefined &&
        message.sources.length > 0 ? (
          <button
            type="button"
            className="dsh-qa-message__sources"
            onClick={() =>
              onOpenSources(
                message.sources ?? [],
                message.sourcesComplete ?? true,
                message.incompleteSourceOrigins,
              )
            }
          >
            Источники ({message.sources.length})
          </button>
        ) : null}
        {showActions ? (
          <div
            className="dsh-qa-message__actions"
            data-persistent={persistentMeta || undefined}
          >
            {message.role === "user" ? meta : null}
            <button
              type="button"
              aria-label={copied ? "Скопировано" : "Скопировать сообщение"}
              title={copied ? "Скопировано" : "Копировать"}
              onClick={() => void copy()}
            >
              {copied ? (
                <svg viewBox="0 0 18 18" aria-hidden="true">
                  <path d="m4.5 9.25 2.75 2.75 6.25-6.25" />
                </svg>
              ) : (
                <svg viewBox="0 0 18 18" aria-hidden="true">
                  <rect x="6.25" y="3.25" width="8.5" height="8.5" rx="2" />
                  <path d="M11.75 11.75v.5a2.5 2.5 0 0 1-2.5 2.5h-3.5a2.5 2.5 0 0 1-2.5-2.5v-3.5a2.5 2.5 0 0 1 2.5-2.5h.5" />
                </svg>
              )}
            </button>
            {message.role === "user" ? null : (
              <>
                <button
                  type="button"
                  aria-label="Нравится"
                  title="Нравится"
                  aria-pressed={rating === "up"}
                  data-active={rating === "up" || undefined}
                  onClick={() => toggleRating("up")}
                >
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M5.25 8.25 8.1 2.9a1.3 1.3 0 0 1 2.4.75v3.1h3.1c.9 0 1.55.85 1.33 1.72l-1.05 4.2a1.75 1.75 0 0 1-1.7 1.33H5.25m0-5.75v5.75m0-5.75h-2v5.75h2" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Не нравится"
                  title="Не нравится"
                  aria-pressed={rating === "down"}
                  data-active={rating === "down" || undefined}
                  onClick={() => toggleRating("down")}
                >
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M12.75 9.75 9.9 15.1a1.3 1.3 0 0 1-2.4-.75v-3.1H4.4a1.38 1.38 0 0 1-1.33-1.72l1.05-4.2A1.75 1.75 0 0 1 5.82 4h6.93m0 5.75V4m0 5.75h2V4h-2" />
                  </svg>
                </button>
                {onRegenerate === undefined ? null : (
                  <button
                    type="button"
                    aria-label="Перегенерировать"
                    title="Перегенерировать"
                    onClick={onRegenerate}
                  >
                    <svg viewBox="0 0 18 18" aria-hidden="true">
                      <path d="M14.6 9A5.6 5.6 0 1 1 12.9 5l1.7 1.7m0-3.4v3.4h-3.4" />
                    </svg>
                  </button>
                )}
              </>
            )}
            {message.role === "user" ? null : meta}
          </div>
        ) : null}
        {askingWhy ? (
          <FeedbackReasonForm
            onSubmit={(reasons, comment) => {
              setAskingWhy(false);
              persist("down", {
                ...(reasons.length === 0 ? {} : { reasons }),
                ...(comment.trim() === "" ? {} : { comment: comment.trim() }),
              });
            }}
            onSkip={() => {
              setAskingWhy(false);
              persist("down");
            }}
          />
        ) : null}
      </article>
    );
  },
  (prev, next) =>
    prev.renderMarkdown === next.renderMarkdown &&
    prev.showTimestamp === next.showTimestamp &&
    prev.stateKey === next.stateKey &&
    prev.onRegenerate === next.onRegenerate &&
    prev.resolveImage === next.resolveImage &&
    prev.onOpenSources === next.onOpenSources &&
    prev.onSourceDetail === next.onSourceDetail &&
    prev.thinkingPhrases === next.thinkingPhrases &&
    sameMessage(prev.message, next.message),
);
