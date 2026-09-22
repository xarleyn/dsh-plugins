// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserPanel } from "../src/client/BrowserPanel.js";

import {
  host,
  owner,
  panelState,
  SESSION,
  tab,
  takeLease,
  TOKEN,
} from "./browser-panel.helpers.js";

afterEach(cleanup);

describe("BrowserPanel", () => {
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

  it("keeps the lease when a poll reports a different lease length", async () => {
    const { remote, mocks, setState } = host(panelState([tab()], "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();
    const reads = mocks.panelState.mock.calls.length;

    // The Host's advertised lease length is one more fact that arrives with a
    // poll. Acting on it used to run the heartbeat's teardown, which hands the
    // page back: the operator lost a lease they were still holding.
    setState(panelState([tab()], "tab-a", { humanControlLeaseSeconds: 60 }));
    fireEvent.click(screen.getByRole("button", { name: "Действия Browser" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Обновить изображение" }),
    );

    await waitFor(() =>
      expect(mocks.panelState.mock.calls.length).toBeGreaterThan(reads),
    );
    expect(mocks.panelReleaseControl).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Вернуть агенту" })).toBeTruthy();
  });

  it("re-reads the frame when the selection moves to a tab with the same revision", async () => {
    const tabs = [
      tab({ revision: 7 }),
      tab({
        id: "tab-b",
        url: "https://second.test/",
        title: "Second",
        revision: 7,
      }),
    ];
    const { remote, mocks, setState } = host(panelState(tabs, "tab-a"));
    render(<BrowserPanel {...owner(remote)} />);
    await takeLease();
    await screen.findByRole("img", { name: /Example App/u });
    const frames = mocks.panelFrame.mock.calls.length;

    setState(panelState(tabs, "tab-b"));
    // Only the poll re-reads a frame it believes it already has, and a forced
    // read through the menu skips exactly the check under test — so wait for the
    // lease-holder cadence instead (a revision is per tab, and both tabs are on
    // revision 7: remembering the number alone showed the other page's image).
    await waitFor(
      () => {
        expect(mocks.panelFrame.mock.calls.length).toBeGreaterThan(frames);
        expect(mocks.panelFrame).toHaveBeenLastCalledWith(
          TOKEN,
          SESSION,
          "tab-b",
        );
      },
      { timeout: 4_000 },
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
