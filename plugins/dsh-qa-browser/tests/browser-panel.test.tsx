// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserPanel,
  type BrowserPanelRemote,
} from "../src/client/BrowserPanel.js";
import type {
  BrowserPanelState,
  BrowserPanelTab,
  BrowserSessionInfo,
} from "../src/types.js";

afterEach(cleanup);

const TOKEN = "secret-token";
const SESSION = "session-a";
const LEASE_MS = 30_000;

function tab(overrides: Partial<BrowserPanelTab> = {}): BrowserPanelTab {
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

function session(
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

function panelState(
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

type Mock = ReturnType<typeof vi.fn>;

/** Named stubs, so a test can assert on a method without an existence check. */
interface RemoteMocks {
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
function host(initial: BrowserPanelState) {
  let current = initial;
  let leaseOwner: string | null = null;
  const ok = <T,>(value: T) => ({ ok: true as const, value });
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

function owner(remote: BrowserPanelRemote, sessionId: string | null = SESSION) {
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
async function takeLease(): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Взять управление" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Вернуть агенту" })).toBeTruthy(),
  );
}

describe("BrowserPanel", () => {
  it("renders the active tab and its bounded on-demand frame", async () => {
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);

    const image = (await screen.findByRole("img", {
      name: /Example App/u,
    })) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(
      screen.getByRole("textbox", { name: "Адрес Browser" }),
    ).toHaveProperty("value", "https://example.test/app");
    expect(screen.getByText("1440×900")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Example App/u })).toBeTruthy();
    expect(mocks.panelState).toHaveBeenCalledWith(TOKEN, SESSION);
    expect(mocks.panelFrame).toHaveBeenCalledWith(TOKEN, SESSION, "tab-a");
  });

  it("does not call Host remotes without a QA session", async () => {
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    render(<BrowserPanel {...owner(remote, null)} />);

    expect(screen.getByRole("status").textContent).toMatch(/создайте чат/iu);
    await waitFor(() => expect(mocks.panelState).not.toHaveBeenCalled());
    expect(mocks.panelFrame).not.toHaveBeenCalled();
  });

  it("keeps every control closed while the agent drives", async () => {
    const tabs = [
      tab(),
      tab({ id: "tab-b", url: "https://second.test/", title: "Second" }),
    ];
    const { remote, mocks } = host(panelState(tabs, "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);
    await screen.findByRole("img", { name: /Example App/u });

    // A watcher may look, not act: no tab may be selected, opened or closed,
    // and the page may not be driven from here.
    expect(
      screen.getByRole("button", { name: "Закрыть вкладку: Example App" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Новая вкладка" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("textbox", { name: "Адрес Browser" }),
    ).toHaveProperty("readOnly", true);
    fireEvent.click(screen.getByRole("tab", { name: /Second/u }));
    expect(mocks.panelSelectTab).not.toHaveBeenCalled();

    // The menu stays reachable, but only its read-only entries act.
    fireEvent.click(screen.getByRole("button", { name: "Действия Browser" }));
    expect(
      screen.getByRole("menuitem", { name: "Закрыть вкладку" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("menuitem", { name: "Перезагрузить страницу" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Обновить изображение" }),
    );
    await waitFor(() => expect(mocks.panelFrame).toHaveBeenCalledTimes(2));
  });

  it("takes explicit control and maps panel clicks to source viewport coordinates", async () => {
    const { remote, mocks } = host(
      panelState(
        [
          tab({
            viewport: { width: 1_000, height: 500, deviceScaleFactor: 1 },
          }),
        ],
        "tab-a",
      ),
    );
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();

    const image = (await screen.findByRole("img", {
      name: /Example App/u,
    })) as HTMLImageElement;
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      width: 500,
      height: 250,
      right: 600,
      bottom: 300,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
    fireEvent.click(image, { clientX: 350, clientY: 175, detail: 1 });

    await waitFor(() => expect(mocks.panelPointer).toHaveBeenCalled());
    const call = mocks.panelPointer.mock.calls[0] as unknown[];
    expect(call.slice(0, 6)).toEqual([
      TOKEN,
      SESSION,
      "tab-a",
      expect.any(String),
      "click",
      500,
    ]);
    expect(call[6]).toBe(250);
    expect(call[7]).toBe("left");
    expect(call[8]).toBe(1);
  });

  it("walks, opens and closes tabs once it holds the lease", async () => {
    const tabs = [
      tab(),
      tab({ id: "tab-b", url: "https://second.test/", title: "Second" }),
    ];
    const { remote, mocks } = host(panelState(tabs, "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();

    fireEvent.click(screen.getByRole("tab", { name: /Second/u }));
    await waitFor(() =>
      expect(mocks.panelSelectTab).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-b",
        expect.any(String),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Новая вкладка" }));
    await waitFor(() => expect(mocks.panelNewTab).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: "Закрыть вкладку: Example App" }),
    );
    await waitFor(() =>
      expect(mocks.panelCloseTab).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-a",
        expect.any(String),
      ),
    );
  });

  it("offers the history it can walk and asks the Host to walk it", async () => {
    const { remote, mocks } = host(
      panelState([tab({ history: { back: 0, forward: 2 } })], "tab-a"),
    );
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();

    // Depth, not a guess: nothing behind this page, two pages ahead of it.
    expect(screen.getByRole("button", { name: "Назад" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    await waitFor(() =>
      expect(mocks.panelHistory).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-a",
        expect.any(String),
        "forward",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Перезагрузить страницу" }),
    );
    await waitFor(() =>
      expect(mocks.panelHistory).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-a",
        expect.any(String),
        "reload",
      ),
    );
  });

  it("navigates from the address field and completes a bare host", async () => {
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();

    const field = screen.getByRole("textbox", { name: "Адрес Browser" });
    fireEvent.change(field, { target: { value: "second.test/page" } });
    fireEvent.submit(field.closest("form")!);

    await waitFor(() =>
      expect(mocks.panelNavigate).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-a",
        expect.any(String),
        "https://second.test/page",
      ),
    );
  });

  it("drives the device row: preset, exact size and scale", async () => {
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    const { container } = render(<BrowserPanel {...owner(remote)} />);
    await takeLease();

    fireEvent.click(screen.getByRole("button", { name: "Устройство" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Устройство" }), {
      target: { value: "phone" },
    });
    await waitFor(() =>
      expect(mocks.panelViewport).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-a",
        expect.any(String),
        390,
        844,
      ),
    );

    const width = screen.getByRole("spinbutton", { name: "Ширина вьюпорта" });
    fireEvent.change(width, { target: { value: "800" } });
    fireEvent.blur(width);
    await waitFor(() =>
      expect(mocks.panelViewport).toHaveBeenCalledWith(
        TOKEN,
        SESSION,
        "tab-a",
        expect.any(String),
        800,
        900,
      ),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Масштаб" }), {
      target: { value: "1" },
    });
    await waitFor(() =>
      expect(
        container
          .querySelector(".dsh-qa-browser-panel__canvas")
          ?.getAttribute("style"),
      ).toContain("1440px"),
    );
  });

  it("says so when the deployment forwards no pointer input", async () => {
    const { remote, mocks } = host(
      panelState([tab()], "tab-a", { coordinateInputEnabled: false }),
    );
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();

    expect(
      screen.getByText("Ввод мышью отключён в настройках стенда"),
    ).toBeTruthy();
    const image = (await screen.findByRole("img", {
      name: /Example App/u,
    })) as HTMLImageElement;
    fireEvent.click(image, { clientX: 10, clientY: 10, detail: 1 });
    expect(mocks.panelPointer).not.toHaveBeenCalled();
  });
});
