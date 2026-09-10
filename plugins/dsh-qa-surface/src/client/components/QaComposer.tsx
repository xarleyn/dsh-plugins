import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QaImageDraft, QaImageMediaType } from "../../types.js";

export interface QaComposerProps {
  readonly placeholder: string;
  readonly quickQuestions?: readonly string[];
  readonly canSend: boolean;
  readonly canStop: boolean;
  readonly running: boolean;
  readonly showStop: boolean;
  readonly status: string | null;
  readonly images: readonly QaImageDraft[];
  readonly onImagesChange: (images: readonly QaImageDraft[]) => void;
  readonly onSend: (
    text: string,
    images: readonly QaImageDraft[],
  ) => Promise<boolean>;
  readonly onStop: () => Promise<void>;
}

/** Raster formats the host attachment path accepts. */
const IMAGE_MEDIA_TYPES: readonly QaImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
/** Soft client-side caps; the Host stays authoritative at admission. */
const MAX_IMAGES = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

let imageDraftSequence = 0;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** FileReader covers runtimes without File.arrayBuffer (jsdom). */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

async function fileToImageDraft(file: File): Promise<QaImageDraft | string> {
  if (!IMAGE_MEDIA_TYPES.includes(file.type as QaImageMediaType)) {
    return "Поддерживаются изображения PNG, JPEG, WebP и GIF.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Изображение слишком большое (лимит 15 МБ).";
  }
  const data = bytesToBase64(new Uint8Array(await readAsArrayBuffer(file)));
  imageDraftSequence += 1;
  return {
    id: `image-${imageDraftSequence}`,
    mediaType: file.type as QaImageMediaType,
    name: file.name === "" ? "изображение" : file.name,
    data,
    previewUrl: URL.createObjectURL(file),
  };
}

function ImagePickerIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2.5" y="3.5" width="13" height="11" rx="2" />
      <circle cx="6.4" cy="7.4" r="1.3" />
      <path d="m4 13 3.6-3.6 2 2L12.4 8l2.6 2.6" />
    </svg>
  );
}

export function QaComposer(props: QaComposerProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const images = props.images;
  const send = async (textOverride?: string) => {
    const text = textOverride ?? draft;
    if (submitting || !props.canSend) return;
    if (text.trim() === "" && images.length === 0) return;
    setSubmitting(true);
    try {
      if (await props.onSend(text, images)) {
        if (textOverride === undefined) setDraft("");
        else setDraft("");
        props.onImagesChange([]);
      }
    } finally {
      setSubmitting(false);
      textarea.current?.focus();
    }
  };

  const addFiles = async (files: Iterable<File>) => {
    const incoming = [...files];
    if (incoming.length === 0) return;
    setAttachmentError(null);
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setAttachmentError(`Не больше ${MAX_IMAGES} изображений на сообщение.`);
      return;
    }
    const drafts: QaImageDraft[] = [];
    let error: string | null =
      incoming.length > room
        ? `Не больше ${MAX_IMAGES} изображений на сообщение.`
        : null;
    for (const file of incoming.slice(0, Math.max(0, room))) {
      const draft = await fileToImageDraft(file);
      if (typeof draft === "string") error = draft;
      else drafts.push(draft);
    }
    if (drafts.length > 0) props.onImagesChange([...images, ...drafts]);
    setAttachmentError(error);
  };

  useEffect(() => {
    if (!props.running) textarea.current?.focus();
  }, [props.running]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft]);

  const hasContent = draft.trim() !== "" || images.length > 0;
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
        void addFiles(event.dataTransfer.files);
      }}
    >
      {(props.quickQuestions?.length ?? 0) > 0 ? (
        <div className="dsh-qa-quick-questions" aria-label="Быстрые вопросы">
          {props.quickQuestions?.map((question) => (
            <button
              type="button"
              key={question}
              disabled={!props.canSend || submitting}
              onClick={() => void send(question)}
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}
      <div className="dsh-qa-composer">
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
                  onClick={() =>
                    props.onImagesChange(
                      images.filter((candidate) => candidate.id !== image.id),
                    )
                  }
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
            const files = event.clipboardData?.files;
            if (files !== undefined && files.length > 0) {
              event.preventDefault();
              void addFiles(files);
            }
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
            accept={IMAGE_MEDIA_TYPES.join(",")}
            multiple
            className="dsh-qa-sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void addFiles(event.target.files ?? []);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="dsh-qa-composer__attach"
            aria-label="Прикрепить изображения"
            title="Прикрепить изображения"
            disabled={!props.canSend || images.length >= MAX_IMAGES}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePickerIcon />
          </button>
          <span className="dsh-qa-composer__hint" aria-live="polite">
            {props.status ?? "Enter: отправить, Shift+Enter: новая строка"}
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
}
