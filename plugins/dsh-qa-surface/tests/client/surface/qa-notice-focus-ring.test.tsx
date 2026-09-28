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
import type { ResolvedQaSurfaceConfig } from "../../../src/types.js";
import {
  focusRing,
  focusable,
  isInert,
} from "../../../src/client/focus-ring.js";
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
/**
 * The element the application is mounted into. The onboarding gate marks this
 * one inert rather than the surface, and jsdom reflects nothing from an `inert`
 * property into an attribute — so the stand has to give it a node it can find by
 * id, or the gate marks nothing and a test of the gate tests an empty room.
 */
let appRoot: HTMLDivElement | undefined;

/**
 * The config the surface reads, with the write the deployment's own settings use.
 * Publishing a config that switches a part of the surface off is how a test takes
 * a control of `<main>` out of the page while the reader stands on it, and makes
 * the surface re-render over that loss — the one shape of loss the notice ring is
 * not meant to answer for.
 */
interface ConfigStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => unknown;
  /** The config the surface is reading now, the one a test edits against. */
  readonly current: () => ResolvedQaSurfaceConfig;
  readonly publish: (config: ResolvedQaSurfaceConfig) => void;
}

function createConfigStore(initial: ResolvedQaSurfaceConfig): ConfigStore {
  let snapshot = { status: "ready" as const, config: initial, error: null };
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    current: () => snapshot.config,
    publish: (config) => {
      snapshot = { status: "ready", config, error: null };
      for (const listener of [...listeners]) listener();
    },
  };
}

let configs: ConfigStore | undefined;

afterEach(() => {
  cleanup();
  document.hasFocus = keepFocus;
  route?.dispose();
  route = undefined;
  configs = undefined;
  appRoot?.remove();
  appRoot = undefined;
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
  /**
   * Put the chat rail on screen. Its footer is the one control of an anonymous
   * stand that opens a `QaModal` of the surface, and the dialog case cannot be
   * read out of a page that holds no dialog to open.
   */
  readonly withSessionList?: boolean;
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
  const config = resolveConfig(
    options.withSessionList === true ? { ui: { showSessionList: true } } : {},
  );
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

  const sectionsSnapshot = { sections: [], revision: 0 };
  configs = createConfigStore(config);
  appRoot = document.createElement("div");
  appRoot.id = "root";
  document.body.append(appRoot);
  render(
    <QaSurface
      {...({
        route,
        config: configs,
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
    { container: appRoot },
  );
  await settle();
  await screen.findByTestId("qa-composer-input");
  // The surface asks for the composer's focus on an animation frame of its own
  // mount, and that frame lands whenever the event loop gets to it. A test that
  // starts working with the keyboard before it has been burned therefore has its
  // focus moved under it mid-case, so the stand waits the frame out here.
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });

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

  it("leaves the keyboard to the gate that holds the page inert", async () => {
    await mount({ withWelcome: true });
    const surface = surfaceRoot();
    const stack = stackRoot();
    // The gate marks the element the application is mounted into, and the
    // surface stands under that mark while the stack, painted into
    // `document.body`, does not. The property is what the ring reads: a browser
    // reflects it into the attribute and jsdom reflects it into nothing, so a
    // test that set the attribute by hand would be describing a state the page
    // never reaches.
    expect(appRoot?.inert).toBe(true);
    expect(isInert(surface)).toBe(true);

    // A control that cannot take focus is not a step of the ring: an edge that
    // pointed into the inert surface would aim `focus()` at a node that ignores
    // it, with the Tab already prevented — a key that sticks.
    expect(
      focusRing([surface, stack]).some((element) => surface.contains(element)),
    ).toBe(false);

    // The gate owns the page while it is up and traps the keys of its own
    // dialog. A second trap drawn over it would leave the reader with nowhere to
    // go but a stack of three buttons, so the ring lets this one through.
    const offer = screen.getByTestId("qa-turn-notice-offer-action");
    offer.focus();
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(offer, { key: "Tab", shiftKey: true })).toBe(true);
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
  });

  it("leaves the stack out of the ring while a dialog of the surface is open", async () => {
    await mount({ withSessionList: true });
    fireEvent.click(screen.getByTestId("qa-surface-sidebar-version"));
    await screen.findByTestId("qa-surface-modal");
    const surface = surfaceRoot();
    const offer = screen.getByTestId("qa-turn-notice-offer-action");

    // `QaModal` marks nothing inert and traps no Tab of its own, so while it is
    // up the dialog is where the reader is and this ring does not own the
    // keyboard. The stack therefore answers nothing, in either direction — the
    // same answer it gave before the notices joined the ring at all. A key taken
    // here would turn the reader out of the dialog and onto a surface held under
    // the scrim.
    offer.focus();
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(offer, { key: "Tab", shiftKey: true })).toBe(true);

    // And the surface's own edge no longer reaches into the stack either: the
    // last control of `<main>` turns back into `<main>`.
    const lastOfMain = focusable(surface).at(-1);
    if (lastOfMain === undefined) throw new Error("the surface holds nothing");
    lastOfMain.focus();
    expect(fireEvent.keyDown(lastOfMain, { key: "Tab" })).toBe(false);
    expect(surface.contains(focused())).toBe(true);
    expect(stackRoot().contains(focused())).toBe(false);

    // Escape given to a notice is the reader's: the stack lets it bubble, and
    // the dialog's own listener on the window is what hears it.
    offer.focus();
    fireEvent.keyDown(offer, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("qa-surface-modal")).toBeNull(),
    );

    // Gone, and the ring is drawn around the stack again.
    expect(fireEvent.keyDown(offer, { key: "Tab" })).toBe(false);
    expect(surfaceRoot().contains(focused())).toBe(true);
  });

  it("walks into the stack from the surface's edge while no dialog is up", async () => {
    await mount();
    const surface = surfaceRoot();
    const lastOfMain = focusable(surface).at(-1);
    if (lastOfMain === undefined) throw new Error("the surface holds nothing");
    lastOfMain.focus();

    // The same key the case above leaves alone: the ring's last step is the
    // stack's last button now, so the edge of `<main>` is a step of the way to
    // the notices rather than the end of the page.
    pressTab();
    expect(stackRoot().contains(focused())).toBe(true);
    expect(focused()).toBe(screen.getByTestId("qa-turn-notice-open"));
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
    // The place is remembered as focus lands on the stack's control, not as the
    // reader proves they work it by keyboard — and a Tab given here is nowhere
    // near the edge of the ring, so the focus stays exactly where it was.
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

  it("leaves the focus alone when a control of the surface goes away under it", async () => {
    await mount();
    const header = screen.getByTestId("qa-surface-header-files");
    // A control that already holds the focus gives no focusin when it is asked
    // for one, so the keyboard is put elsewhere first and walked onto the header
    // — the only way this case says anything about the place it lands on.
    screen.getByTestId("qa-composer-input").focus();
    header.focus();

    // The deployment turned the header off, which is how a control of `<main>`
    // leaves the page under the reader: the surface itself re-renders over the
    // loss, so a ring that remembered this place would be able to answer it.
    const config = configs?.current();
    if (config === undefined) throw new Error("the surface is not mounted");
    act(() =>
      configs?.publish({ ...config, ui: { ...config.ui, showHeader: false } }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("qa-surface-header")).toBeNull(),
    );

    // The same shape of loss — a focused control out of the page and nothing
    // focused after it — read from the surface rather than from the notices. A
    // row of the queue dock, a transcript action taken back by its message, a
    // rebuilt chat: the surface decides where its reader goes after any of those,
    // and a step handed back from the ring would be a rule this card never
    // promised. What the ring remembers is a step of the notice stack only.
    expect(focused()).toBe(document.body);
  });
});
