// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useQaTurnNotifications,
  type QaTurnNotificationsInput,
} from "../../../src/client/notifications/use-turn-notifications.js";

class DesktopNotice {
  static permission: NotificationPermission = "granted";
  static all: DesktopNotice[] = [];
  static requestPermission = vi.fn(
    async (): Promise<NotificationPermission> => "granted",
  );
  onclick: (() => void) | null = null;
  close = vi.fn();
  addEventListener = vi.fn();
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    DesktopNotice.all.push(this);
  }
}

function input(principal = "reader-a"): QaTurnNotificationsInput {
  return {
    principal,
    chats: [{ id: "background", title: "Demo chat", running: false }],
    ownChatIds: ["background"],
    notifications: { enabled: true, allowOs: true },
    storage: localStorage,
    storageKey: "notice-test",
    paused: false,
    activeSessionId: "active",
    account: {
      notifications: { inApp: true, desktop: true },
      onSave: vi.fn(async () => null),
    },
    onSwitch: vi.fn(),
  };
}

function page(initial = input()) {
  const frames: string[][] = [];
  const hook = renderHook(
    (props: QaTurnNotificationsInput) => {
      const notices = useQaTurnNotifications(props);
      useLayoutEffect(() => {
        frames.push(notices.items.map((item) => item.title));
      });
      return notices;
    },
    { initialProps: initial },
  );
  let props = initial;
  function redraw(next: Partial<QaTurnNotificationsInput>) {
    props = { ...props, ...next };
    hook.rerender(props);
  }
  function turn() {
    redraw({
      chats: [{ id: "background", title: "Demo chat", running: true }],
    });
    redraw({
      chats: [{ id: "background", title: "Demo chat", running: false }],
    });
  }
  return { ...hook, redraw, turn, frames, initial };
}

beforeEach(() => {
  localStorage.clear();
  DesktopNotice.all = [];
  DesktopNotice.permission = "granted";
  DesktopNotice.requestPermission.mockReset();
  document.hasFocus = () => false;
  vi.stubGlobal("Notification", DesktopNotice);
  vi.spyOn(window, "focus").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notice ownership and lifecycle", () => {
  it("hides the previous reader's queue in every committed frame and clears its baseline", () => {
    const p = page();
    p.turn();
    expect(p.result.current.items).toHaveLength(1);
    p.frames.length = 0;
    p.redraw({ principal: "reader-b" });
    expect(p.frames.every((frame) => frame.length === 0)).toBe(true);
    p.redraw({
      chats: [{ id: "background", title: "Demo chat", running: true }],
    });
    p.redraw({
      principal: "reader-c",
      chats: [{ id: "background", title: "Demo chat", running: false }],
    });
    expect(p.result.current.items).toEqual([]);
  });

  it("focuses and opens the notified chat, removes its line and retires its desktop handle", () => {
    const p = page();
    p.turn();
    const n = DesktopNotice.all[0]!;
    expect(n.options).toEqual({ body: "Ход завершён" });
    act(() => n.onclick?.());
    expect(window.focus).toHaveBeenCalledOnce();
    expect(p.initial.onSwitch).toHaveBeenCalledWith("background");
    expect(p.result.current.items).toEqual([]);
    expect(n.close).toHaveBeenCalledOnce();
    expect(n.onclick).toBeNull();
  });

  it.each(["logout", "deleted", "unowned", "disabled", "unmount"])(
    "rejects a retained click after %s",
    (cause) => {
      const p = page();
      p.turn();
      const n = DesktopNotice.all[0]!;
      const click = n.onclick!;
      if (cause === "logout") p.redraw({ principal: null });
      if (cause === "deleted") p.redraw({ chats: [] });
      if (cause === "unowned") p.redraw({ ownChatIds: [] });
      if (cause === "disabled")
        p.redraw({ notifications: { enabled: false, allowOs: false } });
      if (cause === "unmount") p.unmount();
      act(() => click());
      expect(p.initial.onSwitch).not.toHaveBeenCalled();
      expect(n.onclick).toBeNull();
      expect(n.close).toHaveBeenCalledOnce();
    },
  );

  it("does not revive old navigation after logout and login as the same reader", () => {
    const p = page();
    p.turn();
    const open = p.result.current.onOpen;
    const click = DesktopNotice.all[0]!.onclick!;
    p.redraw({ principal: null });
    p.redraw({ principal: "reader-a" });
    act(() => {
      open("background");
      click();
    });
    expect(p.initial.onSwitch).not.toHaveBeenCalled();
  });

  it("uses the current navigation callback rather than the one held when raised", () => {
    const p = page();
    p.turn();
    const onSwitch = vi.fn();
    p.redraw({ onSwitch });
    act(() => DesktopNotice.all[0]!.onclick?.());
    expect(onSwitch).toHaveBeenCalledWith("background");
    expect(p.initial.onSwitch).not.toHaveBeenCalled();
  });

  it.each(["switch", "same-reader-login", "unmount"])(
    "drops a permission answer after %s",
    async (cause) => {
      DesktopNotice.permission = "default";
      let answer!: (permission: NotificationPermission) => void;
      DesktopNotice.requestPermission.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      const p = page();
      act(() => p.result.current.onEnableDesktop?.());
      if (cause === "switch") p.redraw({ principal: "reader-b" });
      if (cause === "same-reader-login") {
        p.redraw({ principal: null });
        p.redraw({ principal: "reader-a" });
      }
      if (cause === "unmount") p.unmount();
      await act(async () => {
        answer("granted");
      });
      expect(localStorage.getItem("notice-test")).toBeNull();
      expect(p.initial.account!.onSave).not.toHaveBeenCalled();
    },
  );

  it("closes only the handles belonging to the surface that unmounted", () => {
    const first = page();
    const second = page();
    first.turn();
    second.turn();
    first.unmount();
    expect(DesktopNotice.all[0]!.close).toHaveBeenCalledOnce();
    expect(DesktopNotice.all[1]!.close).not.toHaveBeenCalled();
    act(() => DesktopNotice.all[1]!.onclick?.());
    expect(second.initial.onSwitch).toHaveBeenCalledWith("background");
  });

  it("retires navigation even when the platform refuses to close the notice", () => {
    const p = page();
    p.turn();
    const n = DesktopNotice.all[0]!;
    n.close.mockImplementation(() => {
      throw new Error("close refused");
    });
    p.redraw({ principal: null });
    expect(n.onclick).toBeNull();
  });
});

describe("pending queue refresh boundaries", () => {
  it("keeps a pending line through a transient reconnect list, then prunes a deleted chat", () => {
    const p = page();
    p.turn();
    p.redraw({ paused: true, chats: [] });
    expect(p.result.current.items).toHaveLength(1);
    p.redraw({ paused: false, chatsReady: false });
    expect(p.result.current.items).toHaveLength(1);
    p.redraw({ chatsReady: true });
    expect(p.result.current.items).toEqual([]);
  });
  it("does not reset a baseline on another ownership publication for the same account", () => {
    const p = page();
    p.redraw({
      chats: [{ id: "background", title: "Demo chat", running: true }],
    });
    p.redraw({ ownChatIds: ["background", "new-chat"] });
    p.redraw({
      chats: [{ id: "background", title: "Demo chat", running: false }],
    });
    expect(p.result.current.items).toHaveLength(1);
  });
  it("prevents an old dismiss callback from writing the replacement account's preferences", () => {
    DesktopNotice.permission = "default";
    const p = page();
    p.turn();
    const dismiss = p.result.current.onDismiss;
    p.redraw({ principal: "reader-b" });
    act(() => dismiss("stale-key"));
    expect(localStorage.getItem("notice-test")).toBeNull();
  });
});
