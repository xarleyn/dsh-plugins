import { useEffect, useRef, useState } from "react";

export interface QaComposerProps {
  readonly placeholder: string;
  readonly canSend: boolean;
  readonly canStop: boolean;
  readonly running: boolean;
  readonly showStop: boolean;
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onStop: () => Promise<void>;
}

export function QaComposer(props: QaComposerProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const send = async () => {
    if (submitting || draft.trim() === "" || !props.canSend) return;
    setSubmitting(true);
    try {
      if (await props.onSend(draft)) setDraft("");
    } finally {
      setSubmitting(false);
      textarea.current?.focus();
    }
  };

  useEffect(() => {
    if (!props.running) textarea.current?.focus();
  }, [props.running]);

  return (
    <div className="dsh-qa-composer">
      <label className="dsh-qa-sr-only" htmlFor="dsh-qa-prompt">
        Ask a question
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
            void send();
          }
        }}
      />
      {props.running && props.showStop ? (
        <button
          type="button"
          className="dsh-qa-button dsh-qa-button--stop"
          disabled={!props.canStop}
          onClick={() => void props.onStop()}
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="dsh-qa-button dsh-qa-button--send"
          disabled={!props.canSend || submitting || draft.trim() === ""}
          onClick={() => void send()}
        >
          Send
        </button>
      )}
    </div>
  );
}
