import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  QaAttachmentDraft,
  QaComposerActivity,
  QaSlashView,
  ResolvedQaSlashCommands,
} from "../../types.js";
import {
  attachmentAccept,
  draftFromFile,
  draftFromPaste,
  type QaAttachmentLimits,
} from "../attachments.js";
import type { QaQuickQuestion } from "../types.js";
import { QaSlashPalette } from "../slash/SlashPalette.js";
import { useSlashNavigation } from "../slash/useSlashNavigation.js";
import { QaFileAttachment } from "./QaFileAttachment.js";
import { isQaModalOpen } from "./QaModal.js";
import { QaComposerStatus, QaStopConfirmation } from "./QaComposerStatus.js";
import { isReviewInProgress } from "../answer-review.js";
import { useQaFileDrop } from "../use-qa-file-drop.js";
import type { QaAnswerMode } from "../../shared/answer-modes.js";
import { QaAnswerModes } from "./QaAnswerModes.js";
import { QaComposerAddMenu } from "./QaComposerAddMenu.js";
import {
  isSearchSource,
  sourceLabel,
  type QaSearchSourceEntry,
} from "../../slash/source-prompt.js";

export interface QaComposerProps {
  readonly modelSelector?: ReactNode;
  readonly answerModes?: readonly QaAnswerMode[];
  readonly onAnswerModesChange?: (modes: readonly QaAnswerMode[]) => void;
  readonly placeholder: string;
  /** Shown while the chat is empty; the label reads, the prompt sends. */
  readonly quickQuestions?: readonly QaQuickQuestion[];
  readonly canSend: boolean;
  readonly canStop: boolean;
  readonly running: boolean;
  readonly turn?: number;
  readonly activity?: QaComposerActivity;
  readonly showStop: boolean;
  readonly status: string | null;
  readonly attachments: readonly QaAttachmentDraft[];
  /** Deployment policy: accepted kinds, ceilings and the paste threshold. */
  readonly limits: QaAttachmentLimits;
  /** Slash catalog of this chat; inert while the master switch is off. */
  readonly slash: QaSlashView;
  readonly slashPolicy: ResolvedQaSlashCommands["palette"];
  readonly onAttachmentsChange: (
    attachments: readonly QaAttachmentDraft[],
  ) => void;
  /**
   * `pick` names the entry the user chose in the palette, while the draft
   * still reads as its invocation. It is what disambiguates a skill and a
   * command that share a name; `null` means the draft alone decides.
   */
  readonly onSend: (
    text: string,
    attachments: readonly QaAttachmentDraft[],
    pick: string | null,
    source?: QaSearchSourceEntry,
  ) => Promise<boolean>;
  /** Called when the palette opens, so the caller can revalidate the catalog. */
  readonly onSlashOpen: () => void;
  readonly onStop: () => Promise<void>;
}

/** Stable id stem so `aria-activedescendant` can point at a palette row. */
const SLASH_LIST_ID = "dsh-qa-slash";

/**
 * Return from the composer's own controls, or claim an unowned page. A send
 * completion and a running-state update are not permission to leave a field
 * the user has since entered, or to steer focus behind an open dialog.
 */
function focusComposer(
  input: HTMLTextAreaElement | null,
  owner: HTMLDivElement | null,
): void {
  if (input === null || owner === null || !input.isConnected || input.disabled)
    return;
  if (isQaModalOpen()) return;
  const document = input.ownerDocument;
  const active = document.activeElement;
  if (active?.closest(".dsh-qa-stop-confirmation")) return;
  if (
    active !== null &&
    active !== document.body &&
    active !== document.documentElement &&
    active.isConnected &&
    !owner.contains(active)
  ) {
    return;
  }
  input.focus();
}

function SendIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 13.5v-9m0 0L5.5 8M9 4.5 12.5 8" />
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
  const [source, setSource] = useState<QaSearchSourceEntry>();
  const visibleSource =
    source &&
    props.slash.enabled &&
    props.slash.state === "ready" &&
    props.slash.entries.some(
      (entry) =>
        isSearchSource(entry) &&
        entry.id === source.id &&
        entry.searchSource.label === source.searchSource.label,
    );
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const returnStopFocus = useRef(false);
  const rememberStopFocus = useCallback((hadFocus: boolean) => {
    returnStopFocus.current = hadFocus;
  }, []);
  const confirmationId = useId();
  const reviewing = isReviewInProgress(props.activity);
  const [stopRequest, setStopRequest] = useState<{
    turn?: number;
    reviewing: boolean;
    pending: boolean;
  } | null>(null);
  const mayStop = props.running && props.showStop && props.canStop;
  if (
    stopRequest !== null &&
    (!mayStop ||
      stopRequest.turn !== props.turn ||
      (!stopRequest.pending && stopRequest.reviewing !== reviewing))
  ) {
    setStopRequest(null);
  }
  const confirming = stopRequest?.pending === false;
  useLayoutEffect(() => {
    if (!returnStopFocus.current) return;
    returnStopFocus.current = false;
    if (confirming || isQaModalOpen()) return;
    const document = textarea.current?.ownerDocument;
    if (!document) return;
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== document.documentElement
    )
      return;
    const stop = stopButton.current;
    const target = stop && !stop.disabled ? stop : textarea.current;
    if (target && !target.disabled) target.focus();
  }, [confirming]);
  const dismissStop = () => {
    setStopRequest(null);
    stopButton.current?.focus();
  };
  const confirmStop = async () => {
    if (!mayStop || !confirming) return;
    const pending = { ...stopRequest, pending: true };
    setStopRequest(pending);
    try {
      await props.onStop();
    } finally {
      setStopRequest((current) => (current === pending ? null : current));
    }
  };
  const focusOwner = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = props.attachments;
  const limits = props.limits;
  const images = attachments.filter((item) => item.kind === "image");
  const files = attachments.filter((item) => item.kind === "file");
  const setDraftAtEnd = (text: string) => {
    setDraft(text);
    // The caret must land after the inserted invocation, not at the position
    // the value it replaced happened to have.
    queueMicrotask(() => {
      const element = textarea.current;
      if (element === null) return;
      focusComposer(element, focusOwner.current);
      element.setSelectionRange(text.length, text.length);
    });
  };
  const navigation = useSlashNavigation({
    draft,
    slash: props.slash,
    maxVisible: props.slashPolicy.maxVisible,
    fuzzySearch: props.slashPolicy.fuzzySearch,
    reopen: props.slash.reopen,
    setDraft: setDraftAtEnd,
  });
  const remove = (id: string) => {
    props.onAttachmentsChange(
      attachments.filter((candidate) => candidate.id !== id),
    );
  };
  const send = async (textOverride?: string) => {
    const text = textOverride ?? draft;
    if (submitting || !props.canSend) return;
    if (text.trim() === "" && attachments.length === 0) return;
    // An explicit text (a quick question) is an ordinary prompt by
    // construction: it never carries a palette pick, even while one is
    // pending in the draft it is replacing.
    const pick = textOverride === undefined ? navigation.picked : undefined;
    setSubmitting(true);
    try {
      const accepted = source
        ? await props.onSend(text, attachments, pick?.id ?? null, source)
        : await props.onSend(text, attachments, pick?.id ?? null);
      if (accepted) {
        setSource(undefined);
        setDraft("");
        props.onAttachmentsChange([]);
        // The composer is empty again, so the refusal that emptied it is no
        // longer about anything: it names a file that is not in the tray.
        setAttachmentError(null);
      }
    } finally {
      setSubmitting(false);
      focusComposer(textarea.current, focusOwner.current);
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

  useQaFileDrop({
    element: focusOwner,
    fallback: true,
    canDrop: () => props.canSend && !submitting && !isQaModalOpen(),
    onFiles: (files) => void addFiles(files),
    onActive: setDragOver,
  });

  useEffect(() => {
    if (!props.running) focusComposer(textarea.current, focusOwner.current);
  }, [props.running]);

  useEffect(() => {
    if (navigation.open) props.onSlashOpen();
  }, [navigation.open, props.onSlashOpen]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${String(Math.min(element.scrollHeight, 168))}px`;
  }, [draft]);

  const hasContent = draft.trim() !== "" || attachments.length > 0;
  const activity = stopRequest?.pending ? "stopping" : props.activity;
  const hint =
    submitting && files.length > 0
      ? "Отправляю вложения…"
      : props.activity === undefined
        ? props.status
        : null;
  return (
    <div
      ref={focusOwner}
      className={
        dragOver
          ? "dsh-qa-composer-wrap dsh-qa-composer-wrap--drag"
          : "dsh-qa-composer-wrap"
      }
      data-testid="qa-composer-drop-zone"
      onKeyDown={(event) => {
        if (confirming && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismissStop();
        }
      }}
    >
      {(props.quickQuestions?.length ?? 0) > 0 ? (
        <div
          className="dsh-qa-quick-questions"
          data-testid="qa-composer-quick-questions"
          aria-label="Быстрые вопросы"
        >
          {props.quickQuestions?.map((question, index) => (
            <button
              type="button"
              key={index}
              data-testid="qa-composer-quick-question"
              disabled={!props.canSend || submitting}
              onClick={() => void send(question.prompt)}
            >
              {question.label}
            </button>
          ))}
        </div>
      ) : null}
      {navigation.open ? (
        <QaSlashPalette
          idPrefix={SLASH_LIST_ID}
          rows={navigation.rows}
          activeId={navigation.activeId}
          state={props.slash.state}
          error={props.slash.error}
          commandSurface={props.slash.commandSurface}
          showDescriptions={props.slashPolicy.showDescriptions}
          showKindBadge={props.slashPolicy.showKindBadge}
          onHover={navigation.hover}
          onPick={navigation.pick}
        />
      ) : null}
      <div className="dsh-qa-composer" data-testid="qa-composer">
        {confirming ? (
          <QaStopConfirmation
            id={confirmationId}
            reviewing={reviewing}
            onUnmount={rememberStopFocus}
            onContinue={dismissStop}
            onConfirm={() => void confirmStop()}
          />
        ) : activity !== undefined ? (
          <QaComposerStatus activity={activity} writingHint={props.status} />
        ) : null}
        {files.length === 0 ? null : (
          <div
            className="dsh-qa-composer__files"
            data-testid="qa-composer-files"
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
            data-testid="qa-composer-images"
            aria-label="Прикреплённые изображения"
          >
            {images.map((image) => (
              <span
                key={image.id}
                className="dsh-qa-composer__image"
                data-testid="qa-composer-image"
              >
                <img src={image.previewUrl} alt={image.name} />
                <button
                  type="button"
                  data-testid="qa-composer-image-remove"
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
          <p
            className="dsh-qa-composer__attachment-error"
            data-testid="qa-composer-attachment-error"
            role="alert"
          >
            {attachmentError}
          </p>
        )}
        {source && (
          <div className="dsh-qa-source-chip">
            <span>
              {visibleSource
                ? sourceLabel(source.searchSource)
                : props.slash.state === "loading"
                  ? "Проверяем доступ…"
                  : "Источник недоступен"}
            </span>
            <small>Только для этого сообщения</small>
            <button
              type="button"
              disabled={submitting}
              aria-label="Убрать источник"
              onClick={() => {
                setSource(undefined);
                textarea.current?.focus();
              }}
            >
              ×
            </button>
          </div>
        )}
        <label className="dsh-qa-sr-only" htmlFor="dsh-qa-prompt">
          Задать вопрос
        </label>
        <textarea
          ref={textarea}
          id="dsh-qa-prompt"
          data-testid="qa-composer-input"
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
          role="combobox"
          aria-expanded={navigation.open}
          aria-controls={navigation.open ? `${SLASH_LIST_ID}-list` : undefined}
          aria-activedescendant={
            navigation.activeId === null
              ? undefined
              : `${SLASH_LIST_ID}-option-${String(navigation.active)}`
          }
          onKeyDown={(event) => {
            if (navigation.open) {
              if (
                navigation.active !== -1 &&
                (event.key === "ArrowDown" || event.key === "ArrowUp")
              ) {
                event.preventDefault();
                navigation.move(event.key === "ArrowDown" ? 1 : -1);
                return;
              }
              if (
                event.key === "Tab" &&
                navigation.active !== -1 &&
                !event.shiftKey
              ) {
                // Tab inserts, it does not complete-and-run: the user still
                // has to write the argument and press Enter again.
                event.preventDefault();
                navigation.pickActive();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                navigation.dismiss();
                return;
              }
              if (
                navigation.active !== -1 &&
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                navigation.pickActive();
                return;
              }
            }
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
            data-testid="qa-composer-file-input"
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
          <QaComposerAddMenu
            slash={props.slash}
            disabled={!props.canSend || submitting}
            filesFull={attachments.length >= limits.maxPending}
            onOpen={() => {
              navigation.dismiss();
              props.onSlashOpen();
            }}
            onAttach={() => fileInput.current?.click()}
            onSelect={(entry) => {
              setSource(entry);
              textarea.current?.focus();
            }}
          />
          <div
            className="dsh-qa-composer__context"
            data-testid="qa-composer-context"
          >
            {props.modelSelector}
            {hint === null ? null : (
              <span
                className="dsh-qa-composer__hint"
                data-testid="qa-composer-hint"
                aria-live="polite"
              >
                {hint}
              </span>
            )}
          </div>
          {props.onAnswerModesChange === undefined ? null : (
            <QaAnswerModes
              modes={props.answerModes ?? ["deep"]}
              disabled={!props.canSend || submitting}
              onChange={props.onAnswerModesChange}
            />
          )}
          {props.running && props.showStop ? (
            <button
              type="button"
              className="dsh-qa-composer__action dsh-qa-composer__action--stop"
              data-testid="qa-composer-stop"
              ref={stopButton}
              aria-label="Остановить"
              title="Остановить"
              aria-expanded={confirming}
              aria-controls={confirming ? confirmationId : undefined}
              disabled={!props.canStop || stopRequest?.pending === true}
              onClick={() => {
                if (confirming) dismissStop();
                else
                  setStopRequest({
                    turn: props.turn,
                    reviewing,
                    pending: false,
                  });
              }}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.5" />
              </svg>
            </button>
          ) : null}
          {/* A running turn does not take the question now, it queues it, so
          the field stays writable and the button has to say what it does. */}
          {props.running && props.showStop && props.canSend ? (
            <button
              type="button"
              className="dsh-qa-composer__action dsh-qa-composer__action--send"
              data-testid="qa-composer-send"
              aria-label="Отправить в очередь"
              title="Отправить в очередь"
              disabled={submitting || !hasContent}
              onClick={() => void send()}
            >
              <SendIcon />
            </button>
          ) : null}
          {props.running && props.showStop ? null : (
            <button
              type="button"
              className="dsh-qa-composer__action dsh-qa-composer__action--send"
              data-testid="qa-composer-send"
              aria-label={props.running ? "Отправить в очередь" : "Отправить"}
              title={props.running ? "Отправить в очередь" : "Отправить"}
              disabled={!props.canSend || submitting || !hasContent}
              onClick={() => void send()}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
