import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { QaQueueRow } from "../../types.js";

export interface QaQueueDockProps {
  /** Messages waiting for the agent's next turn, oldest first. */
  readonly rows: readonly QaQueueRow[];
  /** Only a running turn can be interrupted, so only then is "send now" live. */
  readonly running: boolean;
  readonly canEdit: boolean;
  /**
   * Each operation answers with its refusal text, or null when the Host took
   * it; the strip is the only place that answer stays readable.
   */
  readonly onEdit: (id: string, text: string) => Promise<string | null>;
  readonly onSendNow: (id: string) => Promise<string | null>;
  readonly onRemove: (id: string) => Promise<string | null>;
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M11.5 2.5 13.5 4.5 5 13H3v-2z" />
    </svg>
  );
}

function SendNowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 12.5v-9m0 0L4.75 7.75M8 3.5l3.25 4.25" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.4 6.9 8 12.3a2.6 2.6 0 0 1-3.7-3.7l5.4-5.4a1.8 1.8 0 0 1 2.5 2.5l-5.4 5.4a.9.9 0 0 1-1.3-1.3l4.9-4.9" />
    </svg>
  );
}

function ChevronIcon({ up }: { readonly up: boolean }) {
  // The 16 by 16 grid every other icon of this dock is drawn on. The 14 by 14
  // one belongs to the plugin-card shell and to nothing else, and a bundle
  // seated on the Plugins panel row may not carry that chevron at all.
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} />
    </svg>
  );
}

/**
 * Inline editor for one waiting message. A textarea rather than an input:
 * HTML strips newlines out of a single-line value, so editing a multi-line
 * message through one would silently rewrite it as a single line. Enter saves,
 * Shift+Enter breaks the line, Escape cancels.
 */
function QueueEditor({
  label,
  text,
  onChange,
  onSave,
  onCancel,
}: {
  readonly label: string;
  readonly text: string;
  readonly onChange: (text: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${String(Math.min(element.scrollHeight, 120))}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      className="dsh-qa-queue__editor"
      rows={1}
      autoFocus
      aria-label={label}
      value={text}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        ) {
          return;
        }
        event.preventDefault();
        onSave();
      }}
    />
  );
}

/**
 * The queue strip beside the composer. What the user typed while the agent was
 * answering is not in the transcript yet — the Host keeps it until the next
 * turn claims it — so without this strip those messages simply are not on the
 * screen: they cannot be read back, corrected, sent ahead, or dropped.
 *
 * One row shows directly; several fold behind a count so a long queue does not
 * push the composer off the screen. Editing or an operation in flight forces
 * the list open, because either way the user is looking at the rows.
 */
export const QaQueueDock = memo(function QaQueueDock(props: QaQueueDockProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ id: string; text: string } | null>(
    null,
  );
  const listId = useId();
  const { rows, running, canEdit } = props;

  useEffect(() => {
    // A row that left the queue (claimed, or dropped elsewhere) must not keep
    // an editor open, or a complaint about a message no longer waiting.
    const waiting = (id: string) => rows.some((row) => row.id === id);
    if (editing !== null && !waiting(editing.id)) setEditing(null);
    if (refused !== null && !waiting(refused.id)) setRefused(null);
  }, [editing, refused, rows]);

  if (rows.length === 0) return null;

  const mutable = canEdit && busy === null;
  const expanded = !collapsed || editing !== null || busy !== null;
  const listVisible = rows.length === 1 || expanded;

  const run = async (
    id: string,
    operation: () => Promise<string | null>,
  ): Promise<void> => {
    setBusy(id);
    try {
      setRefused((current) =>
        current !== null && current.id === id ? null : current,
      );
      const refusal = await operation();
      setRefused(refusal === null ? null : { id, text: refusal });
    } finally {
      setBusy((current) => (current === id ? null : current));
    }
  };

  const save = async (id: string, text: string): Promise<void> => {
    if (text.trim() === "") return;
    const refusal = await props.onEdit(id, text);
    if (refusal === null) {
      setEditing(null);
      setRefused(null);
      return;
    }
    setRefused({ id, text: refusal });
  };

  return (
    <div className="dsh-qa-queue" data-dsh-qa-queue="">
      {rows.length > 1 ? (
        <button
          type="button"
          className="dsh-qa-queue__header"
          aria-controls={listId}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? "Свернуть очередь сообщений"
              : "Развернуть очередь сообщений"
          }
          disabled={editing !== null || busy !== null}
          onClick={() => {
            setCollapsed((value) => !value);
          }}
        >
          <span className="dsh-qa-queue__count">
            {`${String(rows.length)} в очереди`}
          </span>
          <span className="dsh-qa-queue__chevron">
            <ChevronIcon up={!expanded} />
          </span>
        </button>
      ) : null}
      <ul
        id={listId}
        className="dsh-qa-queue__list"
        aria-label="Очередь сообщений"
        hidden={!listVisible}
      >
        {listVisible
          ? rows.map((row) => (
              <li key={row.id} className="dsh-qa-queue__row">
                {editing?.id === row.id ? (
                  <QueueEditor
                    label="Текст сообщения в очереди"
                    text={editing.text}
                    onChange={(text) => {
                      setEditing({ id: row.id, text });
                    }}
                    onSave={() => {
                      void save(row.id, editing.text);
                    }}
                    onCancel={() => {
                      setEditing(null);
                    }}
                  />
                ) : (
                  <span className="dsh-qa-queue__text">
                    <span className="dsh-qa-queue__preview">
                      {row.preview === ""
                        ? "Сообщение без текста"
                        : row.preview}
                    </span>
                    {row.attachments > 0 ? (
                      <span
                        className="dsh-qa-queue__files"
                        title={`Вложений: ${String(row.attachments)}`}
                      >
                        <PaperclipIcon />
                        {String(row.attachments)}
                      </span>
                    ) : null}
                  </span>
                )}
                {row.sending ? (
                  <span className="dsh-qa-queue__status" role="status">
                    отправляется…
                  </span>
                ) : (
                  <span className="dsh-qa-queue__actions">
                    {editing?.id === row.id ? (
                      <>
                        <button
                          type="button"
                          className="dsh-qa-queue__action"
                          aria-label="Сохранить сообщение в очереди"
                          title="Сохранить"
                          disabled={!mutable || editing.text.trim() === ""}
                          onClick={() => {
                            void save(row.id, editing.text);
                          }}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m3.5 8.5 3 3 6-6.5" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="dsh-qa-queue__action"
                          aria-label="Отменить правку"
                          title="Отменить"
                          disabled={!mutable}
                          onClick={() => {
                            setEditing(null);
                          }}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m4 4 8 8m0-8-8 8" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="dsh-qa-queue__action"
                          aria-label="Изменить сообщение в очереди"
                          title={
                            row.text === null
                              ? "Нельзя изменить сообщение с вложениями"
                              : "Изменить"
                          }
                          disabled={!mutable || row.text === null}
                          onClick={() => {
                            if (row.text !== null)
                              setEditing({ id: row.id, text: row.text });
                          }}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="dsh-qa-queue__action"
                          aria-label="Отправить сообщение из очереди сразу"
                          title={
                            running
                              ? "Отправить сразу"
                              : "Сейчас нечего прерывать"
                          }
                          disabled={!mutable || !running}
                          onClick={() => {
                            void run(row.id, () => props.onSendNow(row.id));
                          }}
                        >
                          <SendNowIcon />
                        </button>
                        <button
                          type="button"
                          className="dsh-qa-queue__action dsh-qa-queue__action--danger"
                          aria-label="Убрать сообщение из очереди"
                          title="Убрать"
                          disabled={!mutable}
                          onClick={() => {
                            void run(row.id, () => props.onRemove(row.id));
                          }}
                        >
                          <RemoveIcon />
                        </button>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))
          : null}
      </ul>
      {refused === null ? null : (
        <p className="dsh-qa-queue__error" role="alert">
          {refused.text}
        </p>
      )}
    </div>
  );
});
