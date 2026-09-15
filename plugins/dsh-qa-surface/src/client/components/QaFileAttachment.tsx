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
}

/**
 * One attached file: the extension badge, the name and the size. The browser
 * never re-reads these bytes (the Host attachment route serves images), so
 * both the composer card and the sent row show the same handle.
 */
export function QaFileAttachment({
  name,
  bytes,
  tone,
  onRemove,
}: QaFileAttachmentProps) {
  return (
    <span className="dsh-qa-file" data-tone={tone} title={name}>
      <span className="dsh-qa-file__badge" aria-hidden="true">
        {badgeText(name)}
      </span>
      <span className="dsh-qa-file__text">
        <span className="dsh-qa-file__name">{name}</span>
        <span className="dsh-qa-file__meta">{formatFileSize(bytes)}</span>
      </span>
      {onRemove === undefined ? null : (
        <button
          type="button"
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
