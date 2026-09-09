import { useEffect, useRef, useState } from "react";
import type { QaMessage as QaMessageModel } from "../../types.js";
import { Markdown } from "./Markdown.js";
import { QaWorkGroup } from "./QaWorkGroup.js";

export interface QaMessageProps {
  readonly message: QaMessageModel;
  readonly renderMarkdown: boolean;
  readonly showTimestamp: boolean;
}

export function QaMessage({
  message,
  renderMarkdown,
  showTimestamp,
}: QaMessageProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
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
        aria-label="Assistant work"
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
      ? "Assistant"
      : message.role === "user"
        ? "You"
        : "Status";
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
  const actionTime =
    showTimestamp && message.timestamp !== undefined ? (
      <time dateTime={new Date(message.timestamp).toISOString()}>
        {new Date(message.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    ) : null;
  const showActions =
    message.role !== "system" && message.status !== "streaming";
  return (
    <article
      className={`dsh-qa-message dsh-qa-message--${message.role}`}
      data-status={message.status}
      aria-label={`${label} message`}
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
        <div className="dsh-qa-message__actions">
          {message.role === "user" ? actionTime : null}
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy message"}
            title={copied ? "Copied" : "Copy"}
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
          {message.role === "assistant" ? actionTime : null}
        </div>
      ) : null}
    </article>
  );
}
