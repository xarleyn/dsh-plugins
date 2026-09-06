import type { QaMessage as QaMessageModel } from "../../types.js";
import { Markdown } from "./Markdown.js";

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
  const label =
    message.role === "assistant"
      ? "Assistant"
      : message.role === "user"
        ? "You"
        : "Status";
  return (
    <article
      className={`dsh-qa-message dsh-qa-message--${message.role}`}
      data-status={message.status}
    >
      <div className="dsh-qa-message__meta">
        <span>{label}</span>
        {showTimestamp && message.timestamp !== undefined ? (
          <time dateTime={new Date(message.timestamp).toISOString()}>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        ) : null}
      </div>
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
    </article>
  );
}
