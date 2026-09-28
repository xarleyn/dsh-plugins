// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { focusRing, focusable } from "../../../src/client/focus-ring.js";
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
/** The chats that exist in the stand's history; a notice is raised per settled one. */
const BACKGROUNDS = [
  "session-background-a",
  "session-background-b",
  "session-background-c",
  "session-background-d",
] as const;
const titleOf = (id: string): string => `Фоновый чат ${id.slice(-1)}`;
const keepFocus = document.hasFocus.bind(document);

// The notice stack is painted into `document.body`, so it is not inside the
// `<main>` whose key handler keeps Tab inside the QA interface. Were the ring
// drawn around `<main>` alone, the key would turn back at the surface's last
// control, and no Tab from the composer would ever reach a notice.

/**
 * The page's tab order as a browser reads it: DOM order over the whole body.
 *
 * Enumerated by production's own `focusable`, so the order the test steps
 * through and the ring that answers the key cannot drift apart — a selector the
 * trap stopped honouring shows up here as a failure rather than as a test that
 * quietly checks its own model of a browser.
 */
function tabbables(): HTMLElement[] {
  return focusable(document.body);
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

function controlOf(
  item: HTMLElement,
  testid: (typeof NOTICE_CONTROLS)[number],
): HTMLElement {
  const control = item.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (control === null) throw new Error(`${testid} is not in the line`);
  return control;
}

const stackRoot = (): HTMLElement => screen.getByTestId("qa-turn-notice");
const lines = (): HTMLElement[] => screen.getAllByTestId("qa-turn-notice-item");
/** The line at this place in the stack; a negative index counts from the end. */
function line(index: number): HTMLElement {
  const item = lines().at(index);
  if (item === undefined) throw new Error(`the stack has no line at ${index}`);
  return item;
}
const surfaceRoot = (): HTMLElement => screen.getByTestId("qa-surface-root");
const focused = (): HTMLElement => document.activeElement as HTMLElement;

/** The stack's own controls, or null when focus is nowhere in it. */
function focusedLine(): HTMLElement | null {
  return focused().closest<HTMLElement>("[data-testid='qa-turn-notice-item']");
}

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

/** Publish one host list frame with the chat's turn running or ended. */
function reportTurn(
  world: QaSessionTestWorld,
  id: string,
  running: boolean,
): void {
  const snapshot = world.list.getSnapshot();
  world.list.set({
    ...snapshot,
    byId: {
      ...snapshot.byId,
      [id]: {
        ...snapshot.byId[id as SessionId],
        blank: false,
        displayTitle: titleOf(id),
        running,
        updatedAt: 2,
      },
    },
  } as SessionListState);
}

/** End the turns of these chats, so the stack gains one line per each. */
function settleTurns(world: QaSessionTestWorld, ids: readonly string[]): void {
  act(() => {
    for (const id of ids) reportTurn(world, id, true);
  });
  act(() => {
    for (const id of ids) reportTurn(world, id, false);
  });
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

interface MountOptions {
  /** Background chats in the reader's history. Defaults to the settled ones. */
  readonly chats?: readonly string[];
  /** Chats whose turn ends while the surface is open. Defaults to one. */
  readonly settled?: readonly string[];
  /** Leave the onboarding gate standing instead of acknowledging it away. */
  readonly withWelcome?: boolean;
}

/**
 * Mount the surface with turns that finished in chats the reader is not looking
 * at: the stack appears, and with it the offer the desktop channel has not been
 * answered in yet.
 */
async function mount(options: MountOptions = {}): Promise<QaSessionTestWorld> {
  const settled = options.settled ?? [BACKGROUNDS[0]];
  const chats = options.chats ?? settled;
  window.history.replaceState(null, "", "/qa");
  const config = resolveConfig({});
  const ns = qaStorageNamespace(config);
  if (options.withWelcome !== true) {
    window.localStorage.setItem(
      `${ns}:welcome-notice`,
      QA_WELCOME_NOTICE_VERSION,
    );
  }
  window.localStorage.setItem(`${ns}:session`, ACTIVE);
  window.localStorage.setItem(
    `${ns}:chats`,
    JSON.stringify([ACTIVE, ...chats]),
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
  const world = harness([ACTIVE, ...chats]);
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
  settleTurns(world, settled);
  await screen.findByTestId("qa-turn-notice");
  return world;
}

describe("the notice stack inside the surface's Tab ring", () => {
  it("carries Tab from the composer over every control of the stack", async () => {
    await mount();
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
    await mount();
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();

    // Past the stack's last button there is nothing of the reader's left to
    // reach, so the key is taken and turned back into the surface.
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surfaceRoot().contains(focused())).toBe(true);
  });

  it("walks Shift+Tab from the surface's first control back into the stack", async () => {
    await mount();
    const surface = surfaceRoot();
    const first = tabbables().find((element) => surface.contains(element));
    expect(first).toBeDefined();
    first?.focus();

    pressTab(true);
    expect(focused()).toBe(screen.getByTestId("qa-turn-notice-offer-action"));
  });

  it("hands a key the ring does not answer to the dialog behind", async () => {
    await mount();
    const dismissed = vi.fn();
    window.addEventListener("keydown", dismissed);
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();

    // The ring answers Tab and nothing else: an Escape given here is the
    // reader's, and a dialog that listens on the window — `QaModal`, and the
    // settings dialog built on it — is what hears it.
    fireEvent.keyDown(dismiss, { key: "Escape" });
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dismiss);

    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(dismissed).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", dismissed);
  });

  it("steps out of the ring while a modal gate holds the surface inert", async () => {
    await mount();
    const surface = surfaceRoot();
    const stack = stackRoot();
    // The onboarding gate marks the surface inert from script. A browser
    // reflects that into the attribute and jsdom implements neither the
    // reflection nor the focus it blocks, so the attribute is what the test
    // sets — the stand run is what settles the pair for real.
    surface.setAttribute("inert", "");

    // A control that cannot take focus is not a step of the ring: an edge that
    // pointed into the inert surface would aim `focus()` at a node that ignores
    // it, with the Tab already prevented — a key that sticks.
    expect(
      focusRing([surface, stack]).some((element) => surface.contains(element)),
    ).toBe(false);

    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();
    // The gate owns the page while it is up, and its dialog traps the keys
    // inside itself. A second trap drawn over it would leave the reader with
    // nowhere to go but the stack, so the ring lets this one through.
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(true);

    surface.removeAttribute("inert");
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surfaceRoot().contains(focused())).toBe(true);
  });

  it("keeps the onboarding dialog's own trap in charge", async () => {
    await mount({ withWelcome: true });
    const dialog = screen.getByTestId("qa-surface-welcome-panel");
    expect(dialog).toBeTruthy();
    screen.getByTestId("qa-surface-welcome-continue").focus();

    // The gate is a trap of its own, mounted beside the surface rather than
    // under it: however many times the reader presses Tab inside the dialog,
    // the surface's ring never hears the key and never pulls them out of it.
    for (let press = 0; press < 4; press++) pressTab();
    expect(dialog.contains(focused())).toBe(true);

    // And the stack the same notice raised keeps the ring around the surface.
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surfaceRoot().contains(focused())).toBe(true);
  });
});

describe("the reader left standing when a notice goes away", () => {
  it("keeps the focus on the line that took a dismissed one's place", async () => {
    await mount({ settled: BACKGROUNDS.slice(0, 3) });
    expect(lines()).toHaveLength(3);
    const dismiss = controlOf(line(1), "qa-turn-notice-dismiss");
    dismiss.focus();

    fireEvent.click(dismiss);
    // Waving one line off three leaves the stack standing and the focused cross
    // out of the page: the count of lines never reaches zero, yet the next Tab
    // would have been answered by the browser's own order.
    expect(lines()).toHaveLength(2);
    expect(focusedLine()).toBe(line(1));
  });

  it("keeps the focus in the stack when a fourth line pushes the oldest out", async () => {
    const world = await mount({
      chats: BACKGROUNDS,
      settled: BACKGROUNDS.slice(0, 3),
    });
    const oldest = line(-1);
    const dismiss = controlOf(oldest, "qa-turn-notice-dismiss");
    dismiss.focus();

    // The stack holds three lines and drops what it cannot show, so a fourth
    // turn changes nothing about its length: the line the reader stood on is
    // gone all the same, and a check on the number of lines would never notice.
    settleTurns(world, [BACKGROUNDS[3]]);
    expect(lines()).toHaveLength(3);
    expect(focusedLine()).toBe(line(-1));
    expect(focusedLine()).not.toBe(oldest);
  });

  it("keeps the focus in the stack when the opt-in answers itself away", async () => {
    await mount();
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();

    // The offer is a single question per browser, so answering the permission
    // prompt takes its button out while the lines stay: the opt-in — the control
    // this card was raised over — is the one that leaves the page under focus.
    fireEvent.click(offer);
    await waitFor(() =>
      expect(screen.queryByTestId("qa-turn-notice-offer-action")).toBeNull(),
    );
    expect(stackRoot()).toBeTruthy();
    expect(focusedLine()).toBe(line(-1));
  });

  it("keeps the focus on a control of the surface when the stack goes away", async () => {
    await mount();
    const dismiss = screen.getByTestId("qa-turn-notice-dismiss");
    dismiss.focus();
    // A key typed inside the stack is what says the reader works it by keyboard.
    fireEvent.keyDown(dismiss, { key: "Tab" });
    expect(document.activeElement).toBe(dismiss);

    fireEvent.click(dismiss);
    expect(screen.queryByTestId("qa-turn-notice")).toBeNull();
    const surface = surfaceRoot();
    expect(surface.contains(focused())).toBe(true);
    // Back into the interface, and onto a control of it rather than onto the
    // surface itself: from a focused root the reader has to press Tab again
    // before the page answers, and the place they were working is lost twice.
    expect(focused()).not.toBe(surface);
    expect(tabbables().some((element) => element === focused())).toBe(true);
  });
});
