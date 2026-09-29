import { createPortal } from "react-dom";
import type { KeyboardEventHandler, RefObject } from "react";
import type { QaTurnNoticeItem } from "../notifications/notification-dispatcher.js";

export interface QaTurnNoticeProps {
  /** Newest first; the stack keeps a handful and drops what it cannot show. */
  readonly items: readonly QaTurnNoticeItem[];
  /** Open the chat a notice is about. */
  readonly onOpen: (sessionId: string) => void;
  /** Take one line out of the stack. */
  readonly onDismiss: (key: string) => void;
  /**
   * Offer the desktop channel. Omitted where no answer can be collected — the
   * stand closed the channel, the browser refuses it, the page has no desktop
   * API — and wherever the reader's own record already says the channel is on.
   * The line is not a fixture of the stack, so the offer shows only while one is.
   */
  readonly onEnableDesktop?: () => void;
  /**
   * The stack is painted in `document.body`, so the surface that owns it keeps
   * its Tab ring reachable: `rootRef` is the element the ring counts these
   * buttons from, and `onKeyDown` traps the key here, where no ancestor
   * `<main>` can hear it. Both are optional — a stand that reads the stack on
   * its own needs neither.
   */
  readonly rootRef?: RefObject<HTMLDivElement>;
  readonly onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

export const QA_TURN_NOTICE_COPY = Object.freeze({
  region: "Уведомления о завершённых ходах",
  finished: "Ход завершён",
  dismiss: "Скрыть уведомление",
  offer: "Системные уведомления приходят, даже когда эта вкладка свёрнута.",
  offerAction: "Включить системные уведомления",
});

/**
 * The line of the stack, named once so the markup and whatever walks the lines
 * cannot drift apart: the surface hands the keyboard back to a neighbouring line
 * when the one the reader stood on goes away, and it finds its lines by this
 * class.
 */
export const QA_TURN_NOTICE_LINE_CLASS = "dsh-qa-turn-notice__item";
export const QA_TURN_NOTICE_LINE_SELECTOR = `.${QA_TURN_NOTICE_LINE_CLASS}`;

/**
 * The offer block, named the same way. It shares the stack with the lines and is
 * none of them: the surface reads the desktop opt-in by this class, rather than
 * by whatever else the stack happens to hold.
 */
export const QA_TURN_NOTICE_OFFER_CLASS = "dsh-qa-turn-notice__offer";
export const QA_TURN_NOTICE_OFFER_SELECTOR = `.${QA_TURN_NOTICE_OFFER_CLASS}`;

function CrossIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m3.5 3.5 7 7m0-7-7 7" />
    </svg>
  );
}

/**
 * The in-app half of a turn-completion notice: one line per chat that settled
 * while the reader was elsewhere, carried by the page until they open the chat
 * or wave it off. It names the chat and the fact — never the answer, which is
 * what the transcript is for.
 */
export function QaTurnNotice(props: QaTurnNoticeProps) {
  const { items, onOpen, onDismiss, onEnableDesktop, rootRef, onKeyDown } =
    props;
  if (items.length === 0) return null;

  return createPortal(
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="dsh-qa-turn-notice"
      data-testid="qa-turn-notice"
      role="region"
      aria-label={QA_TURN_NOTICE_COPY.region}
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          className={QA_TURN_NOTICE_LINE_CLASS}
          data-testid="qa-turn-notice-item"
          key={item.key}
        >
          <button
            type="button"
            className="dsh-qa-turn-notice__open"
            data-testid="qa-turn-notice-open"
            onClick={() => onOpen(item.sessionId)}
          >
            <span className="dsh-qa-turn-notice__state">
              {QA_TURN_NOTICE_COPY.finished}
            </span>
            <span className="dsh-qa-turn-notice__chat">{item.title}</span>
          </button>
          <button
            type="button"
            className="dsh-qa-turn-notice__dismiss"
            data-testid="qa-turn-notice-dismiss"
            aria-label={`${QA_TURN_NOTICE_COPY.dismiss}: ${item.title}`}
            onClick={() => onDismiss(item.key)}
          >
            <CrossIcon />
          </button>
        </div>
      ))}
      {onEnableDesktop === undefined ? null : (
        <div className={QA_TURN_NOTICE_OFFER_CLASS}>
          <p>{QA_TURN_NOTICE_COPY.offer}</p>
          <button
            type="button"
            data-testid="qa-turn-notice-offer-action"
            onClick={onEnableDesktop}
          >
            {QA_TURN_NOTICE_COPY.offerAction}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
