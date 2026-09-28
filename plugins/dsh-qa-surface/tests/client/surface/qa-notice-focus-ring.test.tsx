// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import { QaRouteController } from "../../../src/client/QaRouteController.js";
import {
  QaSurface,
  type QaSurfaceProps,
} from "../../../src/client/QaSurface.js";
import { QaAuditController } from "../../../src/client/audit/controller.js";
import { QaSurfacePanelRegistry } from "../../../src/client/panels/registry.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import { QA_WELCOME_NOTICE_VERSION } from "../../../src/client/components/QaWelcomeNotice.js";
import { qaStorageNamespace } from "../../../src/shared/session-key.js";
import {
  harness,
  type QaSessionTestWorld,
} from "../../helpers/session-fakes.js";
import { settle } from "../../helpers/act.js";

// jsdom has no ResizeObserver; the chat surface's width handles observe it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const ACTIVE = "session-active";
const BACKGROUND = "session-background";
const keepFocus = document.hasFocus.bind(document);

// The notice stack is painted into `document.body`, so it is not inside the
// `<main>` whose key handler keeps Tab inside the QA interface. Were the ring
// drawn around `<main>` alone, the key would turn back at the surface's last
// control, and no Tab from the composer would ever reach a notice.

/** The page's tab order as a browser reads it: DOM order over the whole body. */
function tabbables(): HTMLElement[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ].filter((element) => !element.hidden);
}

/**
 * Press Tab. jsdom moves no focus on its own, so the key goes to the focused
 * element first and only steps to the next tabbable when the surface let it
 * through; a taken key leaves focus where the ring put it.
 */
function pressTab(shift = false): void {
  const from = document.activeElement as HTMLElement;
  const passed = fireEvent.keyDown(from, { key: "Tab", shiftKey: shift });
  if (!passed) return;
  const order = tabbables();
  const index = order.indexOf(from);
  const step = shift ? -1 : 1;
  order[(index + step + order.length) % order.length]?.focus();
}

/** Every control of the stack, in the order the ring walks them. */
const NOTICE_CONTROLS: readonly string[] = [
  "qa-turn-notice-open",
  "qa-turn-notice-dismiss",
  "qa-turn-notice-offer-action",
];

function accessApi() {
  return {
    current: vi.fn(async () => ({
      ok: true as const,
      value: {
        subroles: [],
        defaultSubrole: "general",
        policy: "selectable" as const,
      },
    })),
    session: vi.fn(async () => ({
      ok: true as const,
      value: {
        subrole: {
          id: "general",
          name: "Общий",
          enabled: true,
          capabilities: {
            tools: { always: [], skillGrantable: [] },
            skills: [],
          },
        },
        adminPreview: false,
      },
    })),
  };
}

/** Publish one host list frame with the background chat running or settled. */
function reportBackground(world: QaSessionTestWorld, running: boolean): void {
  const snapshot = world.list.getSnapshot();
  world.list.set({
    ...snapshot,
    byId: {
      ...snapshot.byId,
      [BACKGROUND]: {
        ...snapshot.byId[BACKGROUND as SessionId],
        blank: false,
        displayTitle: "Фоновый чат",
        running,
        updatedAt: 2,
      },
    },
  } as SessionListState);
}

let route: QaRouteController | undefined;

afterEach(() => {
  cleanup();
  document.hasFocus = keepFocus;
  route?.dispose();
  route = undefined;
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

/**
 * Mount the surface with a turn that finishes in a chat the reader is not
 * looking at: the stack appears, and with it the offer the desktop channel
 * has not been answered in yet.
 */
async function mountWithNotice(): Promise<QaSessionTestWorld> {
  window.history.replaceState(null, "", "/qa");
  const config = resolveConfig({});
  const ns = qaStorageNamespace(config);
  window.localStorage.setItem(
    `${ns}:welcome-notice`,
    QA_WELCOME_NOTICE_VERSION,
  );
  window.localStorage.setItem(`${ns}:session`, ACTIVE);
  window.localStorage.setItem(
    `${ns}:chats`,
    JSON.stringify([ACTIVE, BACKGROUND]),
  );
  // An unanswered permission question is what puts the opt-in in the stack.
  class Offered {
    static permission: NotificationPermission = "default";
    static async requestPermission(): Promise<NotificationPermission> {
      return "granted";
    }
    addEventListener(): void {}
    onclick: (() => void) | null = null;
  }
  vi.stubGlobal("Notification", Offered);
  document.hasFocus = () => true;

  route = new QaRouteController();
  route.configure(config, true);
  const world = harness([ACTIVE, BACKGROUND]);
  const face = world.faces.get(ACTIVE);
  face?.source.set({ ...face.source.getSnapshot(), blank: false });

  const configSnapshot = { status: "ready" as const, config, error: null };
  const sectionsSnapshot = { sections: [], revision: 0 };
  render(
    <QaSurface
      {...({
        route,
        config: {
          subscribe: () => () => undefined,
          getSnapshot: () => configSnapshot,
        },
        accessApi: accessApi(),
        sessions: world.sessions,
        api: world.api,
        conversation: world.conversation,
        connection: world.connection,
        secureSession: world.secureSession,
        createSession: world.createSession,
        sourceApi: {
          sources: vi.fn(async () => ({ ok: true as const, value: [] })),
        },
        panels: new QaSurfacePanelRegistry(),
        audit: new QaAuditController(),
        settingsSections: {
          subscribe: () => () => undefined,
          getSnapshot: () => sectionsSnapshot,
          register: () => () => undefined,
        },
        renderSlot: () => null,
      } as unknown as QaSurfaceProps)}
    />,
  );
  await settle();
  await screen.findByTestId("qa-composer-input");

  // The watcher reports a turn it watched run, so the frame arrives in two.
  act(() => reportBackground(world, true));
  act(() => reportBackground(world, false));
  await screen.findByTestId("qa-turn-notice");
  return world;
}

describe("the notice stack inside the surface's Tab ring", () => {
  it("carries Tab from the composer over every control of the stack", async () => {
    await mountWithNotice();
    const composer = await screen.findByTestId("qa-composer-input");
    composer.focus();
    expect(document.activeElement).toBe(composer);

    const seen: string[] = [];
    for (let press = 0; press < 60; press++) {
      const { testid } = (document.activeElement as HTMLElement).dataset;
      if (testid !== undefined && NOTICE_CONTROLS.includes(testid))
        seen.push(testid);
      if (seen.length === NOTICE_CONTROLS.length) break;
      pressTab();
    }
    // The stack's controls, in the order the page lays them out: the line, its
    // cross, and the opt-in the reader has not answered yet.
    expect(seen).toEqual([...NOTICE_CONTROLS]);
  });

  it("keeps focus inside the QA interface at the edge of the stack", async () => {
    await mountWithNotice();
    const surface = screen.getByTestId("qa-surface-root");
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();

    // Past the stack's last button there is nothing of the reader's left to
    // reach, so the key is taken and turned back into the surface.
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surface.contains(document.activeElement)).toBe(true);
  });

  it("walks Shift+Tab from the surface's first control back into the stack", async () => {
    await mountWithNotice();
    const surface = screen.getByTestId("qa-surface-root");
    const first = tabbables().find((element) => surface.contains(element));
    expect(first).toBeDefined();
    first?.focus();

    pressTab(true);
    expect(document.activeElement).toBe(
      screen.getByTestId("qa-turn-notice-offer-action"),
    );
  });

  it("hands a key the ring does not answer to the dialog behind", async () => {
    await mountWithNotice();
    const dismissed = vi.fn();
    window.addEventListener("keydown", dismissed);
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();

    // The stack floats above whatever dialog is open, and Escape there is the
    // reader's answer to that dialog: the ring takes Tab and nothing else.
    fireEvent.keyDown(dismiss, { key: "Escape" });
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dismiss);

    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(dismissed).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", dismissed);
  });

  it("hands the focus back to the surface when the stack goes away", async () => {
    await mountWithNotice();
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();
    // A key typed inside the stack is what says the reader works it by keyboard.
    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(document.activeElement).toBe(dismiss);

    fireEvent.click(dismiss);
    expect(screen.queryByTestId("qa-turn-notice")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("qa-surface-root"));
  });
});
