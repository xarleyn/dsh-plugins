import type { QaAccountNotifications } from "../../types.js";
import type { StorageLike } from "../types.js";

/** One reader's choice about the desktop channel. */
export interface QaNotificationPrefs {
  /** Raise a desktop notice for a finished turn while this page is in the background. */
  readonly osEnabled: boolean;
  /**
   * This browser's one permission prompt has been spent — answered or waved off
   * while it was pending — and the page does not ask it a second time. Says
   * nothing about the channel: with the prompt already granted elsewhere the
   * choice of the channel is {@link osEnabled} alone.
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
