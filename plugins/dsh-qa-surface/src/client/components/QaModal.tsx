import { useEffect, useRef, type ReactNode } from "react";

/**
 * Open dialogs, innermost last. A dialog opened from another one (the tool
 * picker, a delete confirmation) has to own Escape, or one key press would
 * close the whole stack.
 */
const openDialogs: symbol[] = [];

export interface QaModalProps {
  readonly open: boolean;
  /** Dialog title; also the dialog's accessible name. */
  readonly title: string;
  /** Accessible label of the close control, e.g. "Закрыть профиль". */
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Actions pinned under the body; omit for a body-only dialog. */
  readonly footer?: ReactNode;
  readonly wide?: boolean;
  /**
   * Panel size: `wide` fits prose that must not wrap mid-sentence, and
   * `settings` the sectioned user-settings dialog, which needs both a
   * comfortable height and a two-column body.
   */
  readonly size?: "default" | "wide" | "settings";
}

/**
 * The shared QA dialog shell: backdrop, panel, head with the close control,
 * a scrolling body, and an optional footer. Escape and a backdrop click close
 * it, and the close control takes focus on open. Rendering is a no-op while
 * closed, so a closed dialog costs nothing.
 */
export function QaModal(props: QaModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.open) return;
    closeButton.current?.focus();
    const token = Symbol("dsh-qa-modal");
    openDialogs.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openDialogs.at(-1) !== token) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const index = openDialogs.indexOf(token);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div
      className="dsh-qa-modal"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className={`dsh-qa-modal__panel${panelModifier(props)}`}>
        <header className="dsh-qa-modal__head">
          <h2 className="dsh-qa-modal__title">{props.title}</h2>
          <button
            ref={closeButton}
            type="button"
            className="dsh-qa-modal__close"
            aria-label={props.closeLabel}
            onClick={props.onClose}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </header>
        <div className="dsh-qa-modal__body">{props.children}</div>
        {props.footer === undefined ? null : (
          <footer className="dsh-qa-modal__footer">{props.footer}</footer>
        )}
      </div>
    </div>
  );
}

function panelModifier(props: QaModalProps): string {
  const size = props.size ?? (props.wide === true ? "wide" : "default");
  return size === "default" ? "" : ` dsh-qa-modal__panel--${size}`;
}
