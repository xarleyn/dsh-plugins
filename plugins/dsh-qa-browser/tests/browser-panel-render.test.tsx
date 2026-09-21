// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserPanel } from "../src/client/BrowserPanel.js";
import type { BrowserPolicyRefusal } from "../src/types.js";

import {
  host,
  owner,
  panelState,
  SESSION,
  tab,
  TOKEN,
} from "./browser-panel.helpers.js";

afterEach(cleanup);

/** The refusal text the policy produces for a host that resolves privately. */
const PRIVATE_NETWORK_REFUSAL =
  'Private-network destinations are blocked by Browser policy: "intranet.example.corp" resolves to a RFC1918 (10/8, 172.16/12, 192.168/16) address. Allow the host in security.network.allowHosts (or set security.network.allowPrivateNetworks) to reach it.';

/** A request the page made and the policy refused. */
function resourceRefusal(
  overrides: Partial<BrowserPolicyRefusal> = {},
): BrowserPolicyRefusal {
  return {
    code: "BROWSER_HOST_BLOCKED",
    kind: "resource",
    host: "api.intranet.example.corp",
    message: PRIVATE_NETWORK_REFUSAL,
    count: 1,
    ...overrides,
  };
}

/** A navigation the policy refused, i.e. the page itself never opened. */
function documentRefusal(
  overrides: Partial<BrowserPolicyRefusal> = {},
): BrowserPolicyRefusal {
  return resourceRefusal({
    kind: "document",
    host: "intranet.example.corp",
    ...overrides,
  });
}

describe("BrowserPanel", () => {
  it("renders the active tab and its bounded on-demand frame", async () => {
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);

    const image = (await screen.findByRole("img", {
      name: /Example App/u,
    })) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AA==");
    // The address field is a draft synced from the selected tab in an effect,
    // so it settles one flush after the frame appears (raced on CI).
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Адрес Browser" }),
      ).toHaveProperty("value", "https://example.test/app"),
    );
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

  it("renders a frame that settles after the poll effect re-ran", async () => {
    // Regression: the poll effect's cleanup used to invalidate the in-flight
    // frame fetch (requestSequence bump), while its tab-array dependency
    // churned on every poll — the frame arrived and was discarded forever, so
    // the stage stayed on «Получаем изображение…». The cleanup no longer
    // invalidates: a frame settling after a re-run must still mount.
    const releaseRef: { current: ((frame: unknown) => void) | null } = {
      current: null,
    };
    const { remote, mocks } = host(panelState([tab()], "tab-a"));
    mocks.panelFrame.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRef.current = resolve;
        }),
    );
    const first = owner(remote);
    const { rerender } = render(<BrowserPanel {...first} />);
    await waitFor(() => expect(mocks.panelFrame).toHaveBeenCalledTimes(1));

    // The effect re-runs (the host hides the panel); the fetch is still in
    // flight when the cleanup runs.
    rerender(<BrowserPanel {...first} visible={false} />);
    expect(screen.queryByRole("img", { name: /Example App/u })).toBeNull();
    releaseRef.current?.({
      ok: true as const,
      value: {
        tabId: "tab-a",
        revision: 3,
        url: "https://example.test/app",
        title: "Example App",
        mediaType: "image/png",
        bytes: 1,
        data: "AA==",
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /Example App/u })).toBeTruthy(),
    );
  });

  it("shows a refused navigation to the operator, not only to the model", async () => {
    const { remote } = host(
      panelState([tab({ policyRefusals: [documentRefusal()] })], "tab-a"),
    );
    render(<BrowserPanel {...owner(remote)} />);

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("не пускает на intranet.example.corp");
    expect(banner.textContent).toContain("security.network.allowHosts");
  });

  it("explains a page that opened without its blocked requests", async () => {
    const { remote } = host(
      panelState(
        [
          tab({
            policyRefusals: [
              resourceRefusal({ host: "api.intranet.example.corp", count: 3 }),
              resourceRefusal({ host: "cdn.intranet.example.corp" }),
            ],
          }),
        ],
        "tab-a",
      ),
    );
    render(<BrowserPanel {...owner(remote)} />);

    const banner = await screen.findByRole("alert");
    // Nothing about the page failing to open: it opened, and that is the
    // difference the operator needs to read before choosing what to allow.
    expect(banner.textContent).toContain("загрузилась не полностью");
    expect(banner.textContent).toContain("api.intranet.example.corp");
    expect(banner.textContent).toContain("cdn.intranet.example.corp");
    // A retried endpoint is one thing to fix, so it is counted, not repeated.
    expect(banner.textContent).toContain("запросы страницы ×3");
  });

  it("does not explain one tab with another tab's refusals", async () => {
    const refused = tab({
      id: "tab-a",
      title: "Broken",
      policyRefusals: [resourceRefusal({ host: "api.intranet.example.corp" })],
    });
    const clean = tab({
      id: "tab-b",
      url: "https://second.test/",
      title: "Second",
    });
    const { remote } = host(panelState([refused, clean], "tab-b"));
    render(<BrowserPanel {...owner(remote)} />);

    // The tab in front of the operator is the one being explained, and the
    // page on screen was not the one refused anything.
    await screen.findByRole("img", { name: /Second/u });
    expect(screen.queryByRole("alert")).toBeNull();
    // The strip still says which tab is the broken one.
    expect(screen.getByTitle(/Заблокировано запросов/u)).toBeTruthy();
  });

  it("heads a mixed notice with the page's own refusal", async () => {
    const { remote } = host(
      panelState(
        [
          tab({
            policyRefusals: [
              resourceRefusal({ host: "api.intranet.example.corp", count: 2 }),
              documentRefusal({ host: "docs.example.corp" }),
            ],
          }),
        ],
        "tab-a",
        // A refusal with no page behind it rides along with the tab's own.
        {
          policyRefusals: [
            resourceRefusal({ host: "cdn.intranet.example.corp" }),
          ],
        },
      ),
    );
    render(<BrowserPanel {...owner(remote)} />);

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("не пускает на docs.example.corp");
    // The refused requests stay visible: the page did load its shell from an
    // allowed host, and that is where the missing data came from.
    expect(banner.textContent).toContain("api.intranet.example.corp");
    expect(banner.textContent).toContain("cdn.intranet.example.corp");
  });

  it("keeps the banner out of the panel while nothing was refused", async () => {
    const { remote } = host(panelState([tab()], "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);
    await screen.findByRole("img", { name: /Example App/u });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTitle(/Заблокировано запросов/u)).toBeNull();
  });
});
