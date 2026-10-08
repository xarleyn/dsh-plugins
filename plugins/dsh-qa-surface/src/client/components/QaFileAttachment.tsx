import { formatFileSize } from "../attachments.js";

/** Uppercase extension badge; a name without one falls back to a paper glyph. */
function badgeText(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1);
  return extension.length > 0 && extension.length <= 4
    ? extension.toUpperCase()
    : "FILE";
}

export interface QaFileAttachmentProps {
  readonly name: string;
  readonly bytes: number;
  /** Pending draft vs already-sent attachment: pending offers removal. */
  readonly tone: "draft" | "sent";
  readonly onRemove?: () => void;
  /**
   * Open the file: shown as a control on a card the reader can act on, and left
   * out of a chip that only records what was sent. A produced document is
   * worthless as a name in a paragraph — this is what makes it reachable.
   */
  readonly onOpen?: () => void;
  /** Save the file. Omitted where the surface cannot read its bytes. */
  readonly onDownload?: () => void;
}

/**
 * One attached file: the extension badge, the name and the size. A sent
 * attachment shows the handle the model resolved and the browser never
 * re-reads its bytes; a file the turn produced is the same chip with the two
 * controls that make it usable — open it, or take it away.
 */
export function QaFileAttachment({
  name,
  bytes,
  tone,
  onRemove,
  onOpen,
  onDownload,
}: QaFileAttachmentProps) {
  const text = (
    <span className="dsh-qa-file__text">
      <span className="dsh-qa-file__name" data-testid="qa-file-name">
        {name}
      </span>
      <span className="dsh-qa-file__meta" data-testid="qa-file-size">
        {formatFileSize(bytes)}
      </span>
    </span>
  );
  return (
    <span
      className="dsh-qa-file"
      data-testid="qa-file"
      data-tone={tone}
      title={name}
    >
      <span
        className="dsh-qa-file__badge"
        data-testid="qa-file-badge"
        aria-hidden="true"
      >
        {badgeText(name)}
      </span>
      {onOpen === undefined ? (
        text
      ) : (
        <button
          type="button"
          className="dsh-qa-file__open"
          data-testid="qa-file-open"
          aria-label={`Открыть ${name}`}
          title={`Открыть ${name}`}
          onClick={onOpen}
        >
          {text}
        </button>
      )}
      {onDownload === undefined ? null : (
        <button
          type="button"
          className="dsh-qa-file__download"
          data-testid="qa-file-download"
          aria-label={`Скачать ${name}`}
          title="Скачать"
          onClick={onDownload}
        >
          Скачать
        </button>
      )}
      {onRemove === undefined ? null : (
        <button
          type="button"
          data-testid="qa-file-remove"
          aria-label={`Убрать ${name}`}
          title="Убрать"
          onClick={onRemove}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      )}
    </span>
  );
}
