import type { StorageLike } from "../types.js";

/** One reader's choice about the desktop channel. */
export interface QaNotificationPrefs {
  /** Raise a desktop notice for a finished turn while this page is in the background. */
  readonly osEnabled: boolean;
  /** The offer was answered or waved off: a notice never asks a second time. */
  readonly osOffered: boolean;
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
 * The choice lives in this browser, not on the account. That is deliberate for
 * now: an account-level field is a later phase of the design, and a control
 * that only existed once signed in would leave a stand without accounts — the
 * common shape of a QA deployment — with no way to silence itself.
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
