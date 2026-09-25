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

/** Live desktop notices; an unreferenced one is closed by the browser at once. */
const retainedNotices = new Set<Notification>();

/**
 * Hand one finished turn to the desktop. Returns false when the platform
 * refuses: a notification that cannot be raised costs the reader nothing, and
 * the in-app line is already on its way.
 */
export function raiseDesktopNotice(completion: QaTurnCompletion): boolean {
  if (typeof Notification === "undefined") return false;
  try {
    const notice = new Notification(completion.title, {
      body: QA_TURN_NOTICE_BODY,
    });
    notice.onclick = () => window.focus();
    retainedNotices.add(notice);
    notice.addEventListener("close", () => retainedNotices.delete(notice));
    return true;
  } catch {
    return false;
  }
}
