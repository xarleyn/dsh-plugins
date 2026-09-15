import { useEffect, useState } from "react";
import type { QaImageView } from "../../types.js";
import type { QaChatFileGroup } from "../chat-files.js";
import { formatDayTime } from "./format.js";
import { QaFileAttachment } from "./QaFileAttachment.js";

/** One attachment thumbnail, resolved through the controller's asset store. */
function QaFileImage({
  image,
  resolve,
}: {
  readonly image: QaImageView;
  readonly resolve: (attachmentId: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
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
    return <span className="dsh-qa-files__thumb" data-state="loading" />;
  }
  if (url === "") {
    return <span className="dsh-qa-files__thumb" data-state="broken" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        className="dsh-qa-files__thumb"
        src={url}
        alt="Прикреплённое изображение"
      />
    </a>
  );
}

export interface QaFilesPanelProps {
  readonly groups: readonly QaChatFileGroup[];
  /** Resolve an image attachment to an object URL; images render inert without it. */
  readonly resolveImage?: (attachmentId: string) => Promise<string>;
  /** Scroll the transcript to the group's user message. */
  readonly onJumpToMessage: (messageId: string) => void;
}

/**
 * The chat's attachment roster: one section per sending message, newest
 * first. Rows mirror the transcript's handles — the browser never reads a
 * file back, and the images are the same object URLs the message showed.
 */
export function QaFilesPanel({
  groups,
  resolveImage,
  onJumpToMessage,
}: QaFilesPanelProps) {
  if (groups.length === 0) {
    return (
      <div className="dsh-qa-files">
        <p className="dsh-qa-files__empty">В этом чате нет вложений.</p>
      </div>
    );
  }
  return (
    <div className="dsh-qa-files">
      {groups.map((group) => {
        const time =
          group.timestamp === undefined
            ? "Вложенные файлы"
            : formatDayTime(group.timestamp);
        return (
          <section key={group.messageId} className="dsh-qa-files__group">
            <h3>
              <span>{time}</span>
              <button
                type="button"
                className="dsh-qa-files__jump"
                aria-label={`Перейти к сообщению от ${time}`}
                title="К сообщению"
                onClick={() => onJumpToMessage(group.messageId)}
              >
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3.5 7h7m-3-3.5L11 7l-3.5 3.5" />
                </svg>
              </button>
            </h3>
            <div className="dsh-qa-files__items">
              {group.files.map((file) => (
                <QaFileAttachment
                  key={file.attachmentId}
                  name={file.name}
                  bytes={file.bytes}
                  tone="sent"
                />
              ))}
              {group.images.map((image) =>
                resolveImage === undefined ? null : (
                  <QaFileImage
                    key={image.attachmentId}
                    image={image}
                    resolve={resolveImage}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
