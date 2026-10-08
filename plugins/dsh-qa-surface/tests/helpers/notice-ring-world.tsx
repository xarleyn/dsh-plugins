// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { vi } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import { QaRouteController } from "../../src/client/QaRouteController.js";
import { QaSurface, type QaSurfaceProps } from "../../src/client/QaSurface.js";
import { QaAuditController } from "../../src/client/audit/controller.js";
import { QaSurfacePanelRegistry } from "../../src/client/panels/registry.js";
import type { ResolvedQaSurfaceConfig } from "../../src/types.js";
import { focusable } from "../../src/client/focus-ring.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { QA_WELCOME_NOTICE_VERSION } from "../../src/client/components/QaWelcomeNotice.js";
import { qaStorageNamespace } from "../../src/shared/session-key.js";
import { harness, type QaSessionTestWorld } from "./session-fakes.js";
import { settle } from "./act.js";

/**
 * The stand the notice ring is read from: the surface mounted with turns that
 * finished in chats the reader is not looking at, so the stack appears in
 * `document.body` beside the `<main>` whose key handler keeps Tab inside the QA
 * interface. Were the ring drawn around `<main>` alone, the key would turn back
 * at the surface's last control, and no Tab from the composer would ever reach a
 * notice.
 *
 * The cases live in `qa-notice-focus-ring.test.tsx` (the ring over the stack) and
 * `qa-notice-focus-restore.test.tsx` (what a line's loss does to the keyboard).
 * What the enumeration and the trap answer with no surface mounted under them is
 * `qa-focus-ring-markup.test.tsx`.
 */

// jsdom has no ResizeObserver; the chat surface's width handles observe it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const ACTIVE = "session-active";
/** The chats that exist in the stand's history; a notice is raised per settled one. */
export const BACKGROUNDS = [
  "session-background-a",
  "session-background-b",
  "session-background-c",
  "session-background-d",
] as const;
const titleOf = (id: string): string => `Фоновый чат ${id.slice(-1)}`;
const keepFocus = document.hasFocus.bind(document);

/**
 * The page's tab order as a browser reads it: DOM order over the whole body.
 *
 * Enumerated by production's own `focusable`, so the order the test steps
 * through and the ring that answers the key cannot drift apart — a selector the
 * trap stopped honouring shows up here as a failure rather than as a test that
 * quietly checks its own model of a browser.
 */
export function tabbables(): HTMLElement[] {
  return focusable(document.body);
}

/**
 * Press Tab. jsdom moves no focus on its own, so the key goes to the focused
 * element first and only steps to the next tabbable when the surface let it
 * through; a taken key leaves focus where the ring put it.
 */
export function pressTab(shift = false): void {
  const from = document.activeElement as HTMLElement;
  const passed = fireEvent.keyDown(from, { key: "Tab", shiftKey: shift });
  if (!passed) return;
  const order = tabbables();
  const index = order.indexOf(from);
  const step = shift ? -1 : 1;
  order[(index + step + order.length) % order.length]?.focus();
}

/**
 * Give `element` an Enter and report whether the page took the key.
 *
 * jsdom implements no activation behaviour — turning an Enter on a focused
 * button into its click is the browser's work, not the platform's — so the stand
 * asks whether the ring left the key alone and then performs the click that
 * Enter would have been. What a keyboard activation is worth here is the answer
 * to the first question plus the same handler the pointer reaches.
 */
export function pressEnter(element: HTMLElement): boolean {
  const passed = fireEvent.keyDown(element, { key: "Enter" });
  fireEvent.click(element);
  return passed;
}

/** Every control of the stack, in the order the ring walks them. */
export const NOTICE_CONTROLS: readonly string[] = [
  "qa-turn-notice-open",
  "qa-turn-notice-dismiss",
  "qa-turn-notice-offer-action",
];

export function controlOf(
  item: HTMLElement,
  testid: (typeof NOTICE_CONTROLS)[number],
): HTMLElement {
  const control = item.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (control === null) throw new Error(`${testid} is not in the line`);
  return control;
}

export const stackRoot = (): HTMLElement =>
  screen.getByTestId("qa-turn-notice");
export const lines = (): HTMLElement[] =>
  screen.getAllByTestId("qa-turn-notice-item");
/** The line at this place in the stack; a negative index counts from the end. */
export function line(index: number): HTMLElement {
  const item = lines().at(index);
  if (item === undefined) throw new Error(`the stack has no line at ${index}`);
  return item;
}
export const surfaceRoot = (): HTMLElement =>
  screen.getByTestId("qa-surface-root");
export const focused = (): HTMLElement => document.activeElement as HTMLElement;

/**
 * The rules that make a control of the surface a phantom: `.dsh-qa-sidebar`
 * yields to the conversation at ≤600px and `.dsh-qa-rail` goes away at ≤900px
 * (`styles.ts`). Written here bare, because jsdom resolves a rule that stands on
 * a class and applies no media query at all — the sheet is production's, the
 * width is what the reader is assumed to have.
 */
const PHANTOM_WIDTH_RULES =
  ".dsh-qa-sidebar{display:none}.dsh-qa-rail{display:none}";
let phantomSheet: HTMLStyleElement | null = null;

/** Switch the sidebar and the chat rail off, as these widths do. */
export function switchTheWidthOff(): void {
  phantomSheet = document.createElement("style");
  phantomSheet.textContent = PHANTOM_WIDTH_RULES;
  document.head.append(phantomSheet);
}

/** The stack's own controls, or null when focus is nowhere in it. */
export function focusedLine(): HTMLElement | null {
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
export function settleTurns(
  world: QaSessionTestWorld,
  ids: readonly string[],
): void {
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

/** The config the mounted surface is reading, or null before a mount. */
export function currentConfig(): ResolvedQaSurfaceConfig | undefined {
  return configs?.current();
}

/** Write a config the way the deployment's own settings form does. */
export function publishConfig(config: ResolvedQaSurfaceConfig): void {
  configs?.publish(config);
}

/** The element the application is mounted into, inert or not. */
export function applicationRoot(): HTMLDivElement | undefined {
  return appRoot;
}

/** Take the stand down; call it from the test file's `afterEach`. */
export function cleanupNoticeRingWorld(): void {
  cleanup();
  document.hasFocus = keepFocus;
  phantomSheet?.remove();
  phantomSheet = null;
  route?.dispose();
  route = undefined;
  configs = undefined;
  appRoot?.remove();
  appRoot = undefined;
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
}

export interface MountOptions {
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
export async function mount(
  options: MountOptions = {},
): Promise<QaSessionTestWorld> {
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
