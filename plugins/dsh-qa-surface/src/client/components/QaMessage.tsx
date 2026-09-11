import { memo, useEffect, useRef, useState } from "react";
import type {
  QaMessage as QaMessageModel,
  QaImageView,
  QaSource,
  QaTurnSources,
} from "../../types.js";
import { sameWorkItems } from "./QaWorkGroup.js";
import { buildSourceRefs, type QaSourceRefs } from "./source-refs.js";

function QaAttachedImage({
  image,
  resolve,
}: {
  readonly image: QaImageView;
  readonly resolve: (attachmentId: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
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
  }, [image.attachmentId, resolve]);
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
    return sameImages(a.images, b.images);
  }
  if (a.role === "system" && b.role === "system") {
    return (
      (a.notice === undefined) === (b.notice === undefined) &&
      (a.notice === undefined ||
        b.notice === undefined ||
        (a.notice.title === b.notice.title && a.notice.body === b.notice.body))
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
      image.mediaType === (b[index] as QaImageView).mediaType,
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
  }: QaMessageProps) {
    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
    const [rating, setRating] = useState<Rating | null>(null);
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
          />
        </article>
      );
    }
    const label =
      message.role === "assistant"
        ? "Помощник"
        : message.role === "user"
          ? "Вы"
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
    const toggleRating = (value: Rating) => {
      const next = rating === value ? null : value;
      setRating(next);
      writeRating(stateKey, message.id, next);
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
      message.role !== "system" && message.status !== "streaming";
    return (
      <article
        className={`dsh-qa-message dsh-qa-message--${message.role}`}
        data-status={message.status}
        aria-label={`Сообщение: ${label}`}
      >
        <div className="dsh-qa-message__content">
          {message.role === "user" && message.images !== undefined ? (
            <div className="dsh-qa-message__images">
              {message.images.map((image) =>
                resolveImage === undefined ? null : (
                  <QaAttachedImage
                    key={image.attachmentId}
                    image={image}
                    resolve={resolveImage}
                  />
                ),
              )}
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
            Источники · {message.sources.length}
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
    sameMessage(prev.message, next.message),
);
