import { useEffect, useRef, useState } from "react";
import type { QaMessage as QaMessageModel } from "../../types.js";
import { formatDayTime, formatSeconds } from "./format.js";
import { Markdown } from "./Markdown.js";
import { QaWorkGroup } from "./QaWorkGroup.js";

export interface QaMessageProps {
  readonly message: QaMessageModel;
  readonly renderMarkdown: boolean;
  readonly showTimestamp: boolean;
  /** Storage prefix persisted message ratings live under. */
  readonly stateKey?: string;
  /** Ask for a fresh variant of this answer; omit to hide the control. */
  readonly onRegenerate?: () => void;
}

type Rating = "up" | "down";

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

export function QaMessage({
  message,
  renderMarkdown,
  showTimestamp,
  stateKey,
  onRegenerate,
}: QaMessageProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [rating, setRating] = useState<Rating | null>(null);
  useEffect(() => {
    setRating(readRatings(stateKey)[message.id] ?? null);
  }, [stateKey, message.id]);
  useEffect(
    () => () => {
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
    },
    [],
  );
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
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
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
        {message.role === "assistant" && renderMarkdown ? (
          <Markdown text={message.text} />
        ) : (
          message.text
        )}
        {message.status === "streaming" ? (
          <span className="dsh-qa-message__cursor" aria-hidden="true" />
        ) : null}
      </div>
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
}
