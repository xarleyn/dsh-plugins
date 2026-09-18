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

import {
  host,
  owner,
  panelState,
  SESSION,
  tab,
  TOKEN,
} from "./browser-panel.helpers.js";

afterEach(cleanup);

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
});
