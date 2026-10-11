import type { QaTurnCompletion } from "./turn-completion-source.js";
import type { QaNoticeChannels } from "./preferences.js";

/** What the browser exposes of the desktop notification API. */
export type QaNotificationPermission = NotificationPermission | "unsupported";

/** One entry of the in-app stack. */
export interface QaTurnNoticeItem {
  readonly key: string;
  readonly sessionId: string;
  readonly title: string;
}

/** A finished turn and the channels it takes. */
export interface PlannedTurnNotice {
  readonly item: QaTurnNoticeItem;
  /** Keep the line in this page, or send the fact to the desktop alone. */
  readonly inApp: boolean;
  /** Raise the desktop notice as well, or keep this one inside the page. */
  readonly desktop: boolean;
}

export interface QaNoticeContext {
  /** `config.notifications`: the deployment's switches over both channels. */
  readonly switches: { readonly enabled: boolean; readonly allowOs: boolean };
  /** The reader's own choice, from their account or from this browser. */
  readonly channels: QaNoticeChannels;
  readonly permission: QaNotificationPermission;
  /** Whether this page is the one the person is looking at right now. */
  readonly focused: boolean;
  /** The chat the composer is showing. */
  readonly activeSessionId: string | null;
}

/** Body text of every desktop notice: the fact, never the content. */
export const QA_TURN_NOTICE_BODY = "Ход завершён";

/**
 * Decide what one finished turn is worth, if anything.
 *
 * A notice exists to say "this happened where you were not looking". The chat
 * on screen answers itself — the reply arrives in front of the reader — so it
 * gets nothing, while a background chat that settles under their eyes still
 * gets the in-app line. Each channel then needs its own two answers: the
 * deployment's and the reader's. The desktop additionally needs the browser's
 * permission, which neither of those can grant on its behalf.
 */
export function planTurnNotice(
  completion: QaTurnCompletion,
  context: QaNoticeContext,
): PlannedTurnNotice | null {
  const { switches, channels, activeSessionId } = context;
  if (!switches.enabled) return null;
  const onScreen = completion.sessionId === activeSessionId;
  if (context.focused && onScreen) return null;
  const desktop =
    !context.focused &&
    switches.allowOs &&
    channels.desktop &&
    context.permission === "granted";
  if (!channels.inApp && !desktop) return null;
  return {
    item: {
      key: `${completion.sessionId}:${completion.at}`,
      sessionId: completion.sessionId,
      title: completion.title,
    },
    inApp: channels.inApp,
    desktop,
  };
}

/**
 * Whether the person is looking at this page. A hidden tab and a visible tab
 * behind another window both count as away: the notice is for the difference
 * between "watching" and "not watching", not for the tab's own state.
 */
export function isPageFocused(
  documentState: { visibilityState: DocumentVisibilityState } = document,
  hasFocus: () => boolean = () => document.hasFocus(),
): boolean {
  return documentState.visibilityState === "visible" && hasFocus();
}

/** The desktop channel's current answer, or `unsupported` off a secure context. */
export function readNotificationPermission(): QaNotificationPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * Ask the browser for the desktop channel. Only ever called from a click: the
 * permission prompt is the user's decision about this origin, and a page that
 * asks on load — or once per finished turn — spends it on the wrong moment.
 */
export async function requestNotificationPermission(): Promise<QaNotificationPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** One surface's desktop handles, retained until closed or retired. */
export class QaDesktopNotices {
  private readonly handles = new Map<
    Notification,
    { sessionId: string; retire: () => void }
  >();

  retain(
    notice: Notification,
    sessionId: string,
    onOpen?: (sessionId: string) => void,
  ): void {
    let active = true;
    const retire = () => {
      active = false;
      notice.onclick = null;
      notice.removeEventListener?.("close", retire);
      this.handles.delete(notice);
    };
    notice.onclick = () => {
      if (!active) return;
      try {
        window.focus();
        onOpen?.(sessionId);
      } finally {
        this.close(sessionId);
      }
    };
    this.handles.set(notice, { sessionId, retire });
    notice.addEventListener("close", retire);
  }

  /** Revoke callbacks even where the operating system refuses close(). */
  close(sessionId?: string): void {
    for (const [notice, handle] of this.handles) {
      if (sessionId !== undefined && handle.sessionId !== sessionId) continue;
      handle.retire();
      try {
        notice.close();
      } catch {
        /* Platform-owned history is best effort. */
      }
    }
  }

  keep(sessionIds: ReadonlySet<string>): void {
    for (const handle of this.handles.values()) {
      if (!sessionIds.has(handle.sessionId)) this.close(handle.sessionId);
    }
  }
}

const standaloneNotices = new QaDesktopNotices();

/** The session id stays in the callback, never in the desktop payload. */
export function raiseDesktopNotice(
  completion: QaTurnCompletion,
  onOpen?: (sessionId: string) => void,
  notices = standaloneNotices,
): boolean {
  if (typeof Notification === "undefined") return false;
  try {
    const notice = new Notification(completion.title, {
      body: QA_TURN_NOTICE_BODY,
    });
    notices.retain(notice, completion.sessionId, onOpen);
    return true;
  } catch {
    return false;
  }
}
