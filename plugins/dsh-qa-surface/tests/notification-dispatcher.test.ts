// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QaTurnCompletion } from "../src/client/notifications/turn-completion-source.js";
import {
  QA_TURN_NOTICE_BODY,
  isPageFocused,
  planTurnNotice,
  raiseDesktopNotice,
  readNotificationPermission,
  requestNotificationPermission,
  type QaNoticeContext,
} from "../src/client/notifications/notification-dispatcher.js";

const completion: QaTurnCompletion = {
  sessionId: "session-42",
  title: "Монтаж кондиционера",
  at: 1_000,
};

function context(overrides: Partial<QaNoticeContext> = {}): QaNoticeContext {
  return {
    switches: { enabled: true, allowOs: true },
    osChosen: true,
    permission: "granted",
    focused: false,
    activeSessionId: null,
    ...overrides,
  };
}

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static raised: { title: string; body?: string | null }[] = [];
  static asked = 0;

  onclick: (() => void) | null = null;

  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.raised.push({ title, body: options?.body ?? null });
  }

  addEventListener(): void {}

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.asked += 1;
    return FakeNotification.permission;
  }
}

beforeEach(() => {
  FakeNotification.permission = "granted";
  FakeNotification.raised = [];
  FakeNotification.asked = 0;
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planning one finished turn", () => {
  it("raises nothing while the deployment switched the channel off", () => {
    expect(
      planTurnNotice(
        completion,
        context({ switches: { enabled: false, allowOs: false } }),
      ),
    ).toBeNull();
  });

  it("leaves the chat on screen alone while the reader is looking at it", () => {
    // The reply arrives in the transcript: a notice over it would only cover
    // the answer.
    expect(
      planTurnNotice(
        completion,
        context({ focused: true, activeSessionId: "session-42" }),
      ),
    ).toBeNull();
  });

  it("notices a background chat even while the reader is looking", () => {
    const planned = planTurnNotice(
      completion,
      context({ focused: true, activeSessionId: "other" }),
    );
    expect(planned?.item).toEqual({
      key: "session-42:1000",
      sessionId: "session-42",
      title: "Монтаж кондиционера",
    });
    expect(planned?.desktop).toBe(false);
  });

  it("takes the desktop channel only when every gate is open", () => {
    expect(planTurnNotice(completion, context())?.desktop).toBe(true);
    expect(
      planTurnNotice(
        completion,
        context({ switches: { enabled: true, allowOs: false } }),
      )?.desktop,
    ).toBe(false);
    expect(
      planTurnNotice(completion, context({ osChosen: false }))?.desktop,
    ).toBe(false);
    expect(
      planTurnNotice(completion, context({ permission: "denied" }))?.desktop,
    ).toBe(false);
    expect(
      planTurnNotice(completion, context({ permission: "unsupported" }))
        ?.desktop,
    ).toBe(false);
    // Looking at the page keeps the notice inside it.
    expect(
      planTurnNotice(completion, context({ focused: true }))?.desktop,
    ).toBe(false);
  });

  it("still shows the in-app line when the desktop channel is closed", () => {
    const planned = planTurnNotice(
      completion,
      context({ permission: "unsupported", osChosen: false }),
    );
    expect(planned?.item.sessionId).toBe("session-42");
    expect(planned?.desktop).toBe(false);
  });
});

describe("the desktop channel", () => {
  it("carries the chat's name and the bare fact, nothing else", () => {
    expect(raiseDesktopNotice(completion)).toBe(true);
    expect(FakeNotification.raised).toEqual([
      { title: "Монтаж кондиционера", body: QA_TURN_NOTICE_BODY },
    ]);
    const [notice] = FakeNotification.raised;
    // The answer, the session id and any path are what must never leave the
    // page: the desktop writes what it is handed.
    expect(`${notice?.title}${notice?.body ?? ""}`).not.toContain("session-42");
  });

  it("reports failure instead of throwing when the platform refuses", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Notification", undefined);
    expect(raiseDesktopNotice(completion)).toBe(false);
    expect(readNotificationPermission()).toBe("unsupported");
  });

  it("asks once and never on a channel that is already decided", async () => {
    FakeNotification.permission = "default";
    expect(await requestNotificationPermission()).toBe("default");
    expect(FakeNotification.asked).toBe(1);

    FakeNotification.permission = "granted";
    expect(await requestNotificationPermission()).toBe("granted");
    expect(FakeNotification.asked).toBe(1);

    vi.unstubAllGlobals();
    vi.stubGlobal("Notification", undefined);
    expect(await requestNotificationPermission()).toBe("unsupported");
  });

  it("reads the permission without asking for it", () => {
    FakeNotification.permission = "denied";
    expect(readNotificationPermission()).toBe("denied");
    expect(FakeNotification.asked).toBe(0);
  });
});

describe("whether the reader is looking", () => {
  it("counts a hidden tab and an unfocused page as away", () => {
    expect(isPageFocused({ visibilityState: "hidden" }, () => true)).toBe(
      false,
    );
    expect(isPageFocused({ visibilityState: "visible" }, () => false)).toBe(
      false,
    );
    expect(isPageFocused({ visibilityState: "visible" }, () => true)).toBe(
      true,
    );
  });

  it("asks the live document by default", () => {
    document.hasFocus = () => true;
    expect(isPageFocused()).toBe(document.visibilityState === "visible");
  });
});
