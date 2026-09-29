import type { QaAccountNotifications } from "../../types.js";
import type { StorageLike } from "../types.js";

/** One reader's choice about the desktop channel. */
export interface QaNotificationPrefs {
  /** Raise a desktop notice for a finished turn while this page is in the background. */
  readonly osEnabled: boolean;
  /**
   * This page has stopped asking this browser for the desktop channel: the one
   * question it may ask has been answered, or was waved off while it was still
   * open. Nothing here claims the prompt ever reached the screen — a line waved
   * off before the reader saw the question closes it just as well, and from
   * there the answer is given in the browser's own settings. Says nothing about
   * the channel either: where the origin is already granted, {@link osEnabled}
   * is the reader's answer alone.
   */
  readonly osOffered: boolean;
}

/** The channels one finished turn may use, whoever decided them. */
export interface QaNoticeChannels {
  readonly inApp: boolean;
  readonly desktop: boolean;
}

export const QA_NOTIFICATION_DEFAULT_PREFS: QaNotificationPrefs = Object.freeze(
  {
    osEnabled: false,
    osOffered: false,
  },
);

/**
 * Read the stored choice; a denied, full or foreign-shaped store falls back to
 * the silent default rather than raising notices nobody asked for.
 *
 * What is left in this browser is what belongs to a browser: the answer to the
 * desktop offer, and the desktop choice itself for as long as there is no
 * account to hold it. Signed in, the account's {@link QaAccountNotifications}
 * wins — see {@link resolveNoticeChannels} — because a preference that follows
 * the person is the point of storing it on the account at all.
 */
export function readNotificationPrefs(
  storage: StorageLike | undefined,
  key: string,
): QaNotificationPrefs {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return QA_NOTIFICATION_DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return QA_NOTIFICATION_DEFAULT_PREFS;
    }
    const { osEnabled, osOffered } = parsed as Partial<QaNotificationPrefs>;
    return {
      osEnabled: osEnabled === true,
      osOffered: osOffered === true,
    };
  } catch {
    return QA_NOTIFICATION_DEFAULT_PREFS;
  }
}

/** Persist the choice. A store that refuses only costs it across reloads. */
export function writeNotificationPrefs(
  storage: StorageLike | undefined,
  key: string,
  prefs: QaNotificationPrefs,
): void {
  try {
    storage?.setItem(key, JSON.stringify(prefs));
  } catch {
    // The in-memory state already carries the choice for this page.
  }
}

/**
 * Which channels this reader may use for a finished turn.
 *
 * The account's answer wins once it exists, so the choice follows the person to
 * another browser or another laptop. Without an account the browser's own
 * answer stands: an anonymous stand is the common shape of a QA deployment, and
 * a mute switch that only appeared once signed in would leave it with no switch
 * at all. The in-page line has no browser-level switch of its own — a stand that
 * wants it gone has `notifications.enabled`, and the offer this page makes is
 * only ever about the desktop channel.
 */
export function resolveNoticeChannels(input: {
  readonly account: QaAccountNotifications | undefined;
  readonly prefs: QaNotificationPrefs;
}): QaNoticeChannels {
  const { account, prefs } = input;
  if (account !== undefined) {
    return { inApp: account.inApp, desktop: account.desktop };
  }
  return { inApp: true, desktop: prefs.osEnabled };
}
