import { describe, expect, it } from "vitest";
import {
  QA_NOTIFICATION_DEFAULT_PREFS,
  readNotificationPrefs,
  resolveNoticeChannels,
  writeNotificationPrefs,
} from "../src/client/notifications/preferences.js";

const KEY = "dsh-qa-surface.session:v1:/qa:notifications";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function refusingStore() {
  const deny = () => {
    throw new Error("denied");
  };
  return { getItem: deny, setItem: deny, removeItem: deny };
}

describe("notification preferences", () => {
  it("starts silent and reads back what was written", () => {
    const storage = memoryStore();
    expect(readNotificationPrefs(storage, KEY)).toEqual(
      QA_NOTIFICATION_DEFAULT_PREFS,
    );
    writeNotificationPrefs(storage, KEY, { osEnabled: true, osOffered: true });
    expect(readNotificationPrefs(storage, KEY)).toEqual({
      osEnabled: true,
      osOffered: true,
    });
  });

  it("falls back to the silent default on a store it cannot trust", () => {
    for (const raw of ["", "null", "[]", "{oops", '"yes"']) {
      expect(readNotificationPrefs(memoryStore({ [KEY]: raw }), KEY)).toEqual(
        QA_NOTIFICATION_DEFAULT_PREFS,
      );
    }
    expect(
      readNotificationPrefs(memoryStore({ [KEY]: '{"osEnabled":"yes"}' }), KEY),
    ).toEqual(QA_NOTIFICATION_DEFAULT_PREFS);
  });

  it("survives a store that refuses to answer", () => {
    const storage = refusingStore();
    expect(readNotificationPrefs(storage, KEY)).toEqual(
      QA_NOTIFICATION_DEFAULT_PREFS,
    );
    expect(() =>
      writeNotificationPrefs(storage, KEY, {
        osEnabled: true,
        osOffered: true,
      }),
    ).not.toThrow();
    expect(readNotificationPrefs(undefined, KEY)).toEqual(
      QA_NOTIFICATION_DEFAULT_PREFS,
    );
  });
});

describe("the channels one reader may use", () => {
  it("takes the account's answer once there is an account", () => {
    // A shared browser: whatever the previous reader chose here decides nothing
    // about the account signed in now.
    expect(
      resolveNoticeChannels({
        account: { inApp: false, desktop: true },
        prefs: { osEnabled: true, osOffered: true },
      }),
    ).toEqual({ inApp: false, desktop: true });
    expect(
      resolveNoticeChannels({
        account: { inApp: true, desktop: false },
        prefs: { osEnabled: true, osOffered: false },
      }),
    ).toEqual({ inApp: true, desktop: false });
  });

  it("falls back to this browser where there is no account to ask", () => {
    expect(
      resolveNoticeChannels({
        account: undefined,
        prefs: { osEnabled: true, osOffered: true },
      }),
    ).toEqual({ inApp: true, desktop: true });
    // An anonymous stand keeps the in-page line: its mute switch is the
    // deployment's own `notifications.enabled`, not a per-reader choice.
    expect(
      resolveNoticeChannels({
        account: undefined,
        prefs: { osEnabled: false, osOffered: false },
      }),
    ).toEqual({ inApp: true, desktop: false });
  });
});
