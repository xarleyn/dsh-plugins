import type {
  QaAccountNotifications,
  QaAccountNotificationsInput,
} from "./types.js";

/**
 * Per-account choices about the notices a finished turn may raise. Shape,
 * defaults and the normalization both halves of the plugin agree on — the
 * accounts store reads a record it cannot trust, and the settings form sends
 * one back. Free of Node built-ins for the same reason starters.ts is: the
 * browser bundle imports it too.
 */

/** The channels a reader can choose between, in the order the form lists them. */
const NOTIFICATION_CHANNELS = ["inApp", "desktop"] as const;

/**
 * What an account that never opened the notifications form gets.
 *
 * The in-page line is the shipped default of the feature itself, so an
 * untouched account keeps behaving as it did before the form existed. The
 * desktop channel stays off until asked for: raising an operating-system notice
 * is the one choice that leaves the page, and a stand where the browser was
 * never asked must not make it on the account's behalf.
 */
export function emptyNotifications(): QaAccountNotifications {
  return { inApp: true, desktop: false };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read one stored (or wire-delivered) notifications record into its public
 * shape. Unknown or hand-edited input degrades to the readable subset rather
 * than throwing, mirroring the starters read path: a malformed record must
 * never cost the account its session.
 */
export function normalizeNotifications(value: unknown): QaAccountNotifications {
  const raw = asRecord(value);
  if (raw === undefined) return emptyNotifications();
  const defaults = emptyNotifications();
  return {
    inApp: typeof raw.inApp === "boolean" ? raw.inApp : defaults.inApp,
    desktop: typeof raw.desktop === "boolean" ? raw.desktop : defaults.desktop,
  };
}

export type QaNotificationsWriteResult =
  | { readonly ok: true; readonly value: QaAccountNotificationsInput }
  | { readonly ok: false; readonly message: string };

/**
 * Validate one full-replace notifications write. Both channels are required: a
 * payload that names only one would silently reset the other, and the form
 * always sends the pair it was rendered with.
 */
export function validateNotificationsWrite(
  input: unknown,
): QaNotificationsWriteResult {
  const raw = asRecord(input);
  if (raw === undefined) {
    return {
      ok: false,
      message: "the notifications payload is not an object",
    };
  }
  for (const channel of NOTIFICATION_CHANNELS) {
    if (typeof raw[channel] !== "boolean") {
      return { ok: false, message: `${channel} must be a boolean` };
    }
  }
  return {
    ok: true,
    value: { inApp: raw.inApp === true, desktop: raw.desktop === true },
  };
}
