import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface QaComposerProps {
  readonly placeholder: string;
  readonly quickQuestions?: readonly string[];
  readonly canSend: boolean;
  readonly canStop: boolean;
  readonly running: boolean;
  readonly showStop: boolean;
  readonly status: string | null;
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onStop: () => Promise<void>;
}

export function QaComposer(props: QaComposerProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const send = async (text: string) => {
    if (submitting || text.trim() === "" || !props.canSend) return;
    setSubmitting(true);
    try {
      if (await props.onSend(text)) setDraft("");
    } finally {
      setSubmitting(false);
      textarea.current?.focus();
    }
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

  return (
    <div className="dsh-qa-composer-wrap">
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
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className="dsh-qa-composer__toolbar">
          <span className="dsh-qa-composer__hint" aria-live="polite">
            {props.status ?? "Enter — отправить · Shift+Enter — новая строка"}
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
              disabled={!props.canSend || submitting || draft.trim() === ""}
              onClick={() => void send(draft)}
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
