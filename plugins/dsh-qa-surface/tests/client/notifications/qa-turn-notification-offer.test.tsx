// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QA_TURN_NOTICE_COPY,
  QaTurnNotice,
} from "../../../src/client/components/QaTurnNotice.js";
import { useQaTurnNotifications } from "../../../src/client/notifications/use-turn-notifications.js";
import type { QaChatActivity } from "../../../src/client/notifications/turn-completion-source.js";
import type { ResolvedQaSurfaceConfig } from "../../../src/types.js";

const STORAGE_KEY = "dsh-qa-surface.session:v1:/qa:notifications";
const SWITCHES: ResolvedQaSurfaceConfig["notifications"] = {
  enabled: true,
  allowOs: true,
};

function chat(id: string, running: boolean): QaChatActivity {
  return { id, title: `Чат ${id}`, running };
}

class FakeNotification {
  static permission: NotificationPermission = "default";
  static raised: string[] = [];
  static asked = 0;

  onclick: (() => void) | null = null;

  constructor(title: string) {
    FakeNotification.raised.push(title);
  }

  addEventListener(): void {}

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.asked += 1;
    return FakeNotification.permission;
  }
}

/**
 * The page that offers the desktop switch, without the host list around it: the
 * cases below are about which answers this page still owes, and the rows are the
 * least machinery that can produce a finished turn to offer them under.
 */
function Probe(props: { readonly chats: readonly QaChatActivity[] }) {
  const notices = useQaTurnNotifications({
    chats: props.chats,
    notifications: SWITCHES,
    storage: window.localStorage,
    storageKey: STORAGE_KEY,
    paused: false,
    activeSessionId: null,
    onSwitch: () => {},
  });
  return (
    <QaTurnNotice
      items={notices.items}
      onOpen={notices.onOpen}
      onDismiss={notices.onDismiss}
      {...(notices.onEnableDesktop === undefined
        ? {}
        : { onEnableDesktop: notices.onEnableDesktop })}
    />
  );
}

function mountPage(chats: readonly QaChatActivity[]) {
  const view = render(<Probe chats={chats} />);
  return {
    /** One observation of the rows: a running chat that stops has finished a turn. */
    settle(next: readonly QaChatActivity[]) {
      view.rerender(<Probe chats={next} />);
    },
  };
}

function offerButton(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: QA_TURN_NOTICE_COPY.offerAction,
  });
}

function storedPrefs(): unknown {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  document.hasFocus = () => true;
  window.localStorage.clear();
  FakeNotification.permission = "default";
  FakeNotification.raised = [];
  FakeNotification.asked = 0;
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the desktop switch a notice offers", () => {
  it("gives the switch back to a browser whose page stopped asking", async () => {
    // The record holds two separate answers: this page has stopped asking this
    // browser, and the channel is off. While the browser still owes its answer
    // there is no second question to spend, so the line offers nothing — a page
    // that asked once does not ask twice. What the reader then did is outside
    // this page: they allowed the origin in the browser's own settings. From
    // there the spent prompt is no reason to keep the switch away, because on a
    // stand without accounts it is the only way that channel has of being
    // switched on at all, and the mark says nothing about which way it is set.
    FakeNotification.permission = "default";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ osEnabled: false, osOffered: true }),
    );
    const page = mountPage([chat("mine", true)]);
    page.settle([chat("mine", false)]);
    expect(screen.getByText("Чат mine")).toBeTruthy();
    expect(offerButton()).toBeNull();
    expect(FakeNotification.asked).toBe(0);

    FakeNotification.permission = "granted";
    page.settle([chat("mine", false), chat("second", true)]);
    page.settle([chat("mine", false), chat("second", false)]);
    expect(offerButton()).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
    );
    await waitFor(() =>
      expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: true }),
    );
    // The origin had answered for itself: the click spent no prompt, and the
    // mark this browser already carried is left where it was.
    expect(FakeNotification.asked).toBe(0);

    document.hasFocus = () => false;
    page.settle([
      chat("mine", false),
      chat("second", false),
      chat("third", true),
    ]);
    page.settle([
      chat("mine", false),
      chat("second", false),
      chat("third", false),
    ]);
    expect(FakeNotification.raised).toEqual(["Чат third"]);
  });

  it("settles a cross and an answer that asked nothing into one record", async () => {
    // Two answers, and this page renders between neither of them. The reader
    // allowed the origin in the address bar while this frame still carried the
    // question, so the click asks the browser nothing and settles only the
    // channel; the cross under it is the one that answers the question this page
    // asked, and it is the only writer of the mark. Whichever of the two is
    // merged onto the record this frame was rendered with, rather than onto the
    // one this page already wrote, drops the other half out of the store — and a
    // page that lost the mark starts asking a browser that has nothing left to
    // answer.
    FakeNotification.permission = "default";
    const page = mountPage([chat("mine", true)]);
    page.settle([chat("mine", false)]);
    FakeNotification.permission = "granted";
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: QA_TURN_NOTICE_COPY.offerAction }),
      );
      fireEvent.click(
        screen.getByLabelText(`${QA_TURN_NOTICE_COPY.dismiss}: Чат mine`),
      );
      await Promise.resolve();
    });
    expect(storedPrefs()).toEqual({ osEnabled: true, osOffered: true });
    expect(FakeNotification.asked).toBe(0);
  });
});
