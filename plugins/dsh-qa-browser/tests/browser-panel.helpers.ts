import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import type {
  BrowserPanelProps,
  BrowserPanelRemote,
} from "../src/client/BrowserPanel.js";
import type {
  BrowserPanelState,
  BrowserPanelTab,
  BrowserSessionInfo,
} from "../src/types.js";

export const TOKEN = "secret-token";
export const SESSION = "session-a";
export const LEASE_MS = 30_000;

export function tab(overrides: Partial<BrowserPanelTab> = {}): BrowserPanelTab {
  return {
    id: "tab-a",
    url: "https://example.test/app",
    title: "Example App",
    status: "ready",
    revision: 3,
    viewport: { width: 1_440, height: 900, deviceScaleFactor: 1 },
    history: { back: 0, forward: 0 },
    ...overrides,
  };
}

export function session(
  tabs: readonly BrowserPanelTab[],
  selectedTabId: string | null,
): BrowserSessionInfo {
  return {
    sessionId: SESSION,
    status: "ready",
    selectedTabId,
    tabIds: tabs.map((candidate) => candidate.id),
    control: { owner: "agent", leaseExpiresAt: null },
    profileName: null,
    createdAt: 1,
    lastActivityAt: 2,
  };
}

export function panelState(
  tabs: readonly BrowserPanelTab[],
  selectedTabId: string | null,
  overrides: Partial<BrowserPanelState> = {},
): BrowserPanelState {
  return {
    session: session(tabs, selectedTabId),
    tabs,
    humanControlEnabled: true,
    humanControlLeaseSeconds: 30,
    autoRevealOnAgentActivity: true,
    focusOnAutoReveal: false,
    coordinateInputEnabled: true,
    ...overrides,
  };
}

export type Mock = ReturnType<typeof vi.fn>;

/** Named stubs, so a test can assert on a method without an existence check. */
export interface RemoteMocks {
  readonly panelState: Mock;
  readonly panelFrame: Mock;
  readonly panelTakeControl: Mock;
  readonly panelReleaseControl: Mock;
  readonly panelSelectTab: Mock;
  readonly panelNavigate: Mock;
  readonly panelPointer: Mock;
  readonly panelNewTab: Mock;
  readonly panelCloseTab: Mock;
  readonly panelHistory: Mock;
  readonly panelViewport: Mock;
}

/**
 * A Host stub that behaves like the real one where the panel can tell: it
 * remembers which client holds the lease, echoes that client back in every
 * subsequent state, and answers frames from the current tab.
 */
export function host(initial: BrowserPanelState) {
  let current = initial;
  let leaseOwner: string | null = null;
  const ok = <T>(value: T) => ({ ok: true as const, value });
  const withControl = (state: BrowserPanelState): BrowserPanelState => ({
    ...state,
    session:
      state.session === null
        ? null
        : {
            ...state.session,
            control:
              leaseOwner === null
                ? { owner: "agent", leaseExpiresAt: null }
                : {
                    owner: "human",
                    clientId: leaseOwner,
                    leaseExpiresAt: Date.now() + LEASE_MS,
                  },
          },
  });
  const mocks: Record<string, Mock> = {};
  const method = (name: string, answer: (...args: never[]) => unknown) => {
    const mock = vi.fn(async (...args: never[]) => ok(answer(...args)));
    mocks[name] = mock;
    return mock;
  };

  const remote = {
    panelState: method("panelState", () => withControl(current)),
    panelFrame: method("panelFrame", () => {
      const selected = current.tabs.find(
        (candidate) => candidate.id === current.session?.selectedTabId,
      );
      return {
        tabId: selected?.id ?? "tab-a",
        revision: selected?.revision ?? 0,
        url: selected?.url ?? "",
        title: selected?.title ?? "",
        mediaType: "image/png",
        bytes: 1,
        data: "AA==",
      };
    }),
    panelTakeControl: method("panelTakeControl", ((...args: string[]) => {
      leaseOwner = args[2] ?? null;
      return {
        owner: "human",
        clientId: leaseOwner,
        leaseExpiresAt: Date.now() + LEASE_MS,
      };
    }) as never),
    panelControlHeartbeat: method("panelControlHeartbeat", (() => ({
      owner: "human",
      clientId: leaseOwner,
      leaseExpiresAt: Date.now() + LEASE_MS,
    })) as never),
    panelReleaseControl: method("panelReleaseControl", (() => {
      leaseOwner = null;
      return { owner: "agent", leaseExpiresAt: null };
    }) as never),
    panelSelectTab: method("panelSelectTab", (() => true) as never),
    panelNavigate: method("panelNavigate", (() => current) as never),
    panelPointer: method("panelPointer", (() => current) as never),
    panelKey: method("panelKey", (() => current) as never),
    panelText: method("panelText", (() => current) as never),
    panelScroll: method("panelScroll", (() => current) as never),
    panelNewTab: method("panelNewTab", (() => current) as never),
    panelCloseTab: method("panelCloseTab", (() => current) as never),
    panelHistory: method("panelHistory", (() => current) as never),
    panelViewport: method("panelViewport", (() => current) as never),
  } as unknown as BrowserPanelRemote;

  return {
    remote,
    mocks: mocks as unknown as RemoteMocks,
    setState: (next: BrowserPanelState) => {
      current = next;
    },
  };
}

export function owner(
  remote: BrowserPanelRemote,
  sessionId: string | null = SESSION,
): BrowserPanelProps {
  return {
    panelId: "@yadsh/dsh-qa-browser",
    panelKind: "browser",
    sessionId,
    qaToken: TOKEN,
    visible: true,
    presentation: "side" as const,
    params: undefined,
    actions: { close: vi.fn(), reveal: vi.fn() },
    signal: new AbortController().signal,
    browserRemote: remote,
  };
}

/** Render the panel and hand it the lease, which most chrome needs. */
export async function takeLease(): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Взять управление" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Вернуть агенту" })).toBeTruthy(),
  );
}
