import { useEffect, useRef, type ReactNode } from "react";

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
  /**
   * Wider panel, for a dialog whose prose must not wrap mid-sentence. The
   * default width stays with the text-list dialogs it was sized for.
   */
  readonly wide?: boolean;
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      <div
        className={
          props.wide === true
            ? "dsh-qa-modal__panel dsh-qa-modal__panel--wide"
            : "dsh-qa-modal__panel"
        }
      >
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
