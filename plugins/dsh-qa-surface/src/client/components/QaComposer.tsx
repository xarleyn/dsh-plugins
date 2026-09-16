import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QaAttachmentDraft } from "../../types.js";
import {
  attachmentAccept,
  draftFromFile,
  draftFromPaste,
  type QaAttachmentLimits,
} from "../attachments.js";
import type { QaQuickQuestion } from "../types.js";
import { QaFileAttachment } from "./QaFileAttachment.js";

export interface QaComposerProps {
  readonly placeholder: string;
  /** Shown while the chat is empty; the label reads, the prompt sends. */
  readonly quickQuestions?: readonly QaQuickQuestion[];
  readonly canSend: boolean;
  readonly canStop: boolean;
  readonly running: boolean;
  readonly showStop: boolean;
  readonly status: string | null;
  readonly attachments: readonly QaAttachmentDraft[];
  /** Deployment policy: accepted kinds, ceilings and the paste threshold. */
  readonly limits: QaAttachmentLimits;
  readonly onAttachmentsChange: (
    attachments: readonly QaAttachmentDraft[],
  ) => void;
  readonly onSend: (
    text: string,
    attachments: readonly QaAttachmentDraft[],
  ) => Promise<boolean>;
  readonly onStop: () => Promise<void>;
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M16.08 8.29 9.19 15.18a4.5 4.5 0 0 1-6.37-6.37l6.89-6.89a3 3 0 0 1 4.25 4.25l-6.9 6.89a1.5 1.5 0 0 1-2.12-2.12l6.37-6.36" />
    </svg>
  );
}

/**
 * Memoized with the default shallow compare: every prop is a scalar, a
 * stable array or a stable callback, so a stream of transcript frames never
 * re-renders the composer and typing stays responsive while an answer runs.
 * The caller owns the draft array identity: `limits` must be stable too.
 */
export const QaComposer = memo(function QaComposer(props: QaComposerProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = props.attachments;
  const limits = props.limits;
  const images = attachments.filter((item) => item.kind === "image");
  const files = attachments.filter((item) => item.kind === "file");
  const remove = (id: string) => {
    props.onAttachmentsChange(
      attachments.filter((candidate) => candidate.id !== id),
    );
  };
  const send = async (textOverride?: string) => {
    const text = textOverride ?? draft;
    if (submitting || !props.canSend) return;
    if (text.trim() === "" && attachments.length === 0) return;
    setSubmitting(true);
    try {
      if (await props.onSend(text, attachments)) {
        setDraft("");
        props.onAttachmentsChange([]);
      }
    } finally {
      setSubmitting(false);
      textarea.current?.focus();
    }
  };

  const addFiles = async (incoming: ReadonlyArray<File>) => {
    if (incoming.length === 0) return;
    setAttachmentError(null);
    const room = limits.maxPending - attachments.length;
    if (room <= 0) {
      setAttachmentError(
        `Не больше ${String(limits.maxPending)} вложений на сообщение.`,
      );
      return;
    }
    const drafts: QaAttachmentDraft[] = [];
    let error: string | null =
      incoming.length > room
        ? `Не больше ${String(limits.maxPending)} вложений на сообщение.`
        : null;
    for (const file of incoming.slice(0, room)) {
      const draft = await draftFromFile(file, limits);
      if (typeof draft === "string") error = draft;
      else drafts.push(draft);
    }
    if (drafts.length > 0)
      props.onAttachmentsChange([...attachments, ...drafts]);
    setAttachmentError(error);
  };

  useEffect(() => {
    if (!props.running) textarea.current?.focus();
  }, [props.running]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${String(Math.min(element.scrollHeight, 168))}px`;
  }, [draft]);

  const hasContent = draft.trim() !== "" || attachments.length > 0;
  const hint =
    submitting && files.length > 0
      ? "Отправляю вложения…"
      : (props.status ?? "Enter: отправить, Shift+Enter: новая строка");
  return (
    <div
      className={
        dragOver
          ? "dsh-qa-composer-wrap dsh-qa-composer-wrap--drag"
          : "dsh-qa-composer-wrap"
      }
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      {(props.quickQuestions?.length ?? 0) > 0 ? (
        <div className="dsh-qa-quick-questions" aria-label="Быстрые вопросы">
          {props.quickQuestions?.map((question, index) => (
            <button
              type="button"
              key={index}
              disabled={!props.canSend || submitting}
              onClick={() => void send(question.prompt)}
            >
              {question.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="dsh-qa-composer">
        {files.length === 0 ? null : (
          <div
            className="dsh-qa-composer__files"
            aria-label="Прикреплённые файлы"
          >
            {files.map((file) => (
              <QaFileAttachment
                key={file.id}
                name={file.name}
                bytes={file.bytes}
                tone="draft"
                onRemove={() => {
                  remove(file.id);
                }}
              />
            ))}
          </div>
        )}
        {images.length === 0 ? null : (
          <div
            className="dsh-qa-composer__images"
            aria-label="Прикреплённые изображения"
          >
            {images.map((image) => (
              <span key={image.id} className="dsh-qa-composer__image">
                <img src={image.previewUrl} alt={image.name} />
                <button
                  type="button"
                  aria-label={`Убрать ${image.name}`}
                  title="Убрать"
                  onClick={() => {
                    remove(image.id);
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 4 8 8m0-8-8 8" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        {attachmentError === null ? null : (
          <p className="dsh-qa-composer__attachment-error" role="alert">
            {attachmentError}
          </p>
        )}
        <label className="dsh-qa-sr-only" htmlFor="dsh-qa-prompt">
          Задать вопрос
        </label>
        <textarea
          ref={textarea}
          id="dsh-qa-prompt"
          rows={1}
          value={draft}
          placeholder={props.placeholder}
          disabled={!props.canSend && !props.running}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onPaste={(event) => {
            const pasted = [...(event.clipboardData?.files ?? [])];
            if (pasted.length > 0) {
              event.preventDefault();
              void addFiles(pasted);
              return;
            }
            // A long paste becomes an attachment instead of a wall of text in
            // the field; everything shorter pastes normally.
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const attachment = draftFromPaste(text, limits);
            if (attachment === null) return;
            if (attachments.length >= limits.maxPending) {
              // Nothing is swallowed: the text still lands in the field. The
              // room refusal rides the same alert line as a rejected file.
              setAttachmentError(
                `Не больше ${String(limits.maxPending)} вложений на сообщение.`,
              );
              return;
            }
            event.preventDefault();
            setAttachmentError(null);
            props.onAttachmentsChange([...attachments, attachment]);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="dsh-qa-composer__toolbar">
          <input
            ref={fileInput}
            type="file"
            accept={attachmentAccept(limits)}
            multiple
            className="dsh-qa-sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void addFiles([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="dsh-qa-composer__attach"
            aria-label="Прикрепить файл"
            title="Прикрепить файл или изображение"
            disabled={!props.canSend || attachments.length >= limits.maxPending}
            onClick={() => fileInput.current?.click()}
          >
            <AttachIcon />
          </button>
          <span className="dsh-qa-composer__hint" aria-live="polite">
            {hint}
          </span>
          {props.running && props.showStop ? (
            <button
              type="button"
              className="dsh-qa-composer__action dsh-qa-composer__action--stop"
              aria-label="Остановить"
              title="Остановить"
              disabled={!props.canStop}
              onClick={() => void props.onStop()}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="dsh-qa-composer__action dsh-qa-composer__action--send"
              aria-label="Отправить"
              title="Отправить"
              disabled={!props.canSend || submitting || !hasContent}
              onClick={() => void send()}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 13.5v-9m0 0L5.5 8M9 4.5 12.5 8" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
