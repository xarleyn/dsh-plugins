// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  QaAccountNotifications,
  QaAccountNotificationsInput,
  ResolvedQaSurfaceConfig,
} from "../../../src/types.js";
import { QaGeneralSettingsPage } from "../../../src/client/user-settings/GeneralSettingsPage.js";
import {
  QA_NOTIFICATION_SETTINGS_COPY,
  QaNotificationSettingsPage,
} from "../../../src/client/user-settings/NotificationSettingsPage.js";
import { QaUserSettingsDialog } from "../../../src/client/user-settings/UserSettingsDialog.js";

type Switches = ResolvedQaSurfaceConfig["notifications"];

const ON = { enabled: true, allowOs: true } as const;

class FakeNotification {
  static permission: NotificationPermission = "granted";
  /** What this browser answers the prompt with: no until a test says so. */
  static grantsOnAsk = false;
  static asked = 0;

  onclick: (() => void) | null = null;

  addEventListener(): void {}

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.asked += 1;
    if (FakeNotification.grantsOnAsk) FakeNotification.permission = "granted";
    return FakeNotification.permission;
  }
}

beforeEach(() => {
  FakeNotification.permission = "granted";
  FakeNotification.grantsOnAsk = false;
  FakeNotification.asked = 0;
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function page(
  props: {
    readonly notifications?: QaAccountNotifications;
    readonly switches?: Switches;
    readonly onSave?: (
      input: QaAccountNotificationsInput,
    ) => Promise<string | null>;
  } = {},
) {
  return render(
    <QaNotificationSettingsPage
      notifications={props.notifications ?? { inApp: true, desktop: false }}
      switches={props.switches ?? { ...ON }}
      onSave={props.onSave ?? vi.fn(async () => null)}
    />,
  );
}

function checkbox(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("QA settings notifications page", () => {
  it("seeds both switches from the account's own record", () => {
    page({ notifications: { inApp: false, desktop: true } });
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.inApp).checked).toBe(false);
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).checked).toBe(true);
  });

  it("saves the pair the reader left, in one full-replace write", async () => {
    const onSave = vi.fn(async () => null);
    page({ onSave });
    fireEvent.click(checkbox(QA_NOTIFICATION_SETTINGS_COPY.inApp));
    fireEvent.click(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ inApp: false, desktop: true }),
    );
    expect(
      await screen.findByText(QA_NOTIFICATION_SETTINGS_COPY.saved),
    ).toBeTruthy();
  });

  it("keeps the page open and shows the refusal copy", async () => {
    page({ onSave: async () => "Не удалось сохранить настройки." });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не удалось сохранить настройки.",
    );
  });

  it("re-seeds the form when the stored record changes", () => {
    const { rerender } = page({
      notifications: { inApp: true, desktop: false },
    });
    rerender(
      <QaNotificationSettingsPage
        notifications={{ inApp: false, desktop: true }}
        switches={{ ...ON }}
        onSave={vi.fn(async () => null)}
      />,
    );
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).checked).toBe(true);
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.inApp).checked).toBe(false);
  });

  it("hands the desktop channel to the stand when it closed it", () => {
    page({ switches: { enabled: true, allowOs: false } });
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).disabled).toBe(true);
    expect(
      screen.getByText(QA_NOTIFICATION_SETTINGS_COPY.desktopOffOnStand),
    ).toBeTruthy();
    // The in-page line is still the reader's own decision.
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.inApp).disabled).toBe(false);
  });

  it("locks both switches and says so on a stand that switched notices off", () => {
    page({ switches: { enabled: false, allowOs: false } });
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).disabled).toBe(true);
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.inApp).disabled).toBe(true);
    expect(
      screen.getByText(QA_NOTIFICATION_SETTINGS_COPY.offOnStand),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("explains a browser that cannot raise a desktop notice at all", () => {
    vi.stubGlobal("Notification", undefined);
    page();
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).disabled).toBe(true);
    expect(
      screen.getByText(QA_NOTIFICATION_SETTINGS_COPY.unsupported),
    ).toBeTruthy();
  });

  it("lets a denied browser keep the choice for the next one", () => {
    FakeNotification.permission = "denied";
    page();
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).disabled).toBe(
      false,
    );
    expect(screen.getByText(QA_NOTIFICATION_SETTINGS_COPY.denied)).toBeTruthy();
  });

  it("asks the browser for permission only when the reader presses it", async () => {
    FakeNotification.permission = "default";
    page();
    // Nothing was asked while the page only rendered.
    expect(FakeNotification.asked).toBe(0);
    expect(
      screen.getByText(QA_NOTIFICATION_SETTINGS_COPY.askHint),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: QA_NOTIFICATION_SETTINGS_COPY.askAction,
      }),
    );
    await waitFor(() => expect(FakeNotification.asked).toBe(1));
    // The reader did not answer the prompt: the switch stays where it was and
    // the question stays on screen for another try.
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).checked).toBe(false);
    expect(
      screen.getByRole("button", {
        name: QA_NOTIFICATION_SETTINGS_COPY.askAction,
      }),
    ).toBeTruthy();
  });

  it("records a granted permission as the reader's own desktop choice", async () => {
    FakeNotification.permission = "default";
    FakeNotification.grantsOnAsk = true;
    page();
    fireEvent.click(
      screen.getByRole("button", {
        name: QA_NOTIFICATION_SETTINGS_COPY.askAction,
      }),
    );
    await waitFor(() =>
      expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).checked).toBe(
        true,
      ),
    );
    // The answer is the reader's, so it still takes a save to reach the account.
    expect(screen.queryByText(QA_NOTIFICATION_SETTINGS_COPY.saved)).toBeNull();
  });
});

describe("notifications inside the settings dialog", () => {
  it("opens as its own section", () => {
    render(
      <QaUserSettingsDialog
        open
        initialSection="general"
        email="i.ivanov@example.com"
        role="user"
        chatCount={3}
        onClose={vi.fn()}
        notifications={{
          notifications: { inApp: true, desktop: false },
          switches: { ...ON },
          onSave: vi.fn(async () => null),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Уведомления" }));
    expect(screen.getByRole("tabpanel", { name: "Уведомления" })).toBeTruthy();
    expect(checkbox(QA_NOTIFICATION_SETTINGS_COPY.desktop).checked).toBe(false);
  });

  it("is gone from the list of things still missing", () => {
    render(
      <QaGeneralSettingsPage
        email="i.ivanov@example.com"
        role="user"
        chatCount={3}
      />,
    );
    // The placeholder named this work; the work now has its own tab.
    expect(screen.queryByText("Настройки уведомлений")).toBeNull();
    expect(screen.queryByText(QA_NOTIFICATION_SETTINGS_COPY.title)).toBeNull();
    // What really is still missing keeps its place on the list.
    expect(screen.getByText("Приватность и хранение данных")).toBeTruthy();
  });
});
