// @vitest-environment jsdom

import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QaPanelHost,
  clampQaPanelWidth,
  type QaPanelHostProps,
} from "../src/client/panels/PanelHost.js";
import { QaPanelLauncher } from "../src/client/panels/PanelLauncher.js";
import { QaSurfacePanelRegistry } from "../src/client/panels/registry.js";
import type { QaSurfacePanelOwnerProps } from "../src/client/panels/contract.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
});

function StatefulPanel({ panelKind, sessionId, params }: QaSurfacePanelOwnerProps) {
  const [value, setValue] = useState("");
  return (
    <label>
      {panelKind}:{sessionId}:{JSON.stringify(params)}
      <input
        aria-label={`${panelKind} state`}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
    </label>
  );
}

function slotRenderer(
  renderBody: (owner: QaSurfacePanelOwnerProps) => ReactNode = (owner) => (
    <StatefulPanel {...owner} />
  ),
): QaPanelHostProps["renderSlot"] {
  return ((_name: string, owner: QaSurfacePanelOwnerProps) =>
    renderBody(owner)) as QaPanelHostProps["renderSlot"];
}

function registerFixtures(panels: QaSurfacePanelRegistry) {
  panels.register({
    id: "fixture-alpha",
    kind: "alpha",
    title: () => "Alpha",
    icon: "browser",
    keepMounted: true,
  });
  panels.register({
    id: "fixture-beta",
    kind: "beta",
    title: () => "Beta",
    icon: "unknown-token",
  });
}

describe("QA panel extension shell", () => {
  it("adds launchers dynamically and programmatic open reserves side width", () => {
    const panels = new QaSurfacePanelRegistry();
    const view = render(
      <div>
        <QaPanelLauncher panels={panels} />
        <div>
          <QaPanelHost panels={panels} sessionId="session-a" renderSlot={slotRenderer()} />
        </div>
      </div>,
    );
    expect(screen.queryByRole("navigation", { name: "Панели QA" })).toBeNull();
    act(() => registerFixtures(panels));
    expect(screen.getAllByRole("button", { name: /Открыть панель/u })).toHaveLength(2);

    act(() => void panels.open("alpha", { focus: false, params: { tab: 2 } }));
    const aside = screen.getByRole("complementary", { name: "Панель: Alpha" });
    expect(aside.dataset.presentation).toBe("side");
    expect(aside.style.width).toMatch(/px$/u);
    expect(screen.getByText(/session-a.*"tab":2/u)).toBeTruthy();
    expect(view.container.querySelector(".dsh-qa-extension-panel__resizer")).toBeTruthy();
  });

  it("omits hidden metadata from launchers but still allows programmatic open", () => {
    const panels = new QaSurfacePanelRegistry();
    panels.register({
      id: "fixture-hidden",
      kind: "hidden",
      title: () => "Hidden",
      userVisible: false,
    });
    render(
      <div>
        <QaPanelLauncher panels={panels} />
        <QaPanelHost panels={panels} sessionId="session-a" renderSlot={slotRenderer()} />
      </div>,
    );
    expect(screen.queryByRole("navigation", { name: "Панели QA" })).toBeNull();
    act(() => void panels.open("hidden", { focus: false }));
    expect(screen.getByRole("complementary", { name: "Панель: Hidden" })).toBeTruthy();
  });

  it("renders a controlled diagnostic when metadata has no keyed body", () => {
    const panels = new QaSurfacePanelRegistry();
    panels.register({ id: "missing", kind: "missing", title: () => "Missing" });
    panels.open("missing", { focus: false });
    const missingSlot = ((
      _name: string,
      _owner: QaSurfacePanelOwnerProps,
      options: { readonly fallback?: ReactNode },
    ) => options.fallback) as QaPanelHostProps["renderSlot"];
    render(
      <div>
        <QaPanelHost panels={panels} sessionId="session-a" renderSlot={missingSlot} />
      </div>,
    );
    expect(screen.getByRole("status").textContent).toMatch(/missing.*недоступна/u);
  });

  it("keeps opted-in bodies mounted and releases ordinary inactive bodies", () => {
    const panels = new QaSurfacePanelRegistry();
    registerFixtures(panels);
    render(
      <div>
        <QaPanelHost panels={panels} sessionId="session-a" renderSlot={slotRenderer()} />
      </div>,
    );
    act(() => void panels.open("alpha", { focus: false }));
    fireEvent.change(screen.getByLabelText("alpha state"), { target: { value: "kept" } });
    act(() => void panels.open("beta", { focus: false }));
    expect(
      screen
        .getByDisplayValue("kept")
        .closest<HTMLElement>(".dsh-qa-extension-panel__body")?.hidden,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("beta state"), { target: { value: "released" } });
    act(() => void panels.open("alpha", { focus: false }));
    expect(screen.getByDisplayValue("kept")).toBeTruthy();
    expect(screen.queryByDisplayValue("released")).toBeNull();
    act(() => void panels.open("beta", { focus: false }));
    expect((screen.getByLabelText("beta state") as HTMLInputElement).value).toBe("");
  });

  it("updates the session prop without remounting a retained body", () => {
    const panels = new QaSurfacePanelRegistry();
    registerFixtures(panels);
    panels.open("alpha", { focus: false });
    const view = render(
      <div>
        <QaPanelHost panels={panels} sessionId="session-a" renderSlot={slotRenderer()} />
      </div>,
    );
    fireEvent.change(screen.getByLabelText("alpha state"), { target: { value: "local" } });
    view.rerender(
      <div>
        <QaPanelHost panels={panels} sessionId="session-b" renderSlot={slotRenderer()} />
      </div>,
    );
    expect(screen.getByText(/alpha:session-b/u)).toBeTruthy();
    expect(screen.getByDisplayValue("local")).toBeTruthy();
  });

  it("uses fullscreen presentation on narrow screens and Escape returns to chat", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    const panels = new QaSurfacePanelRegistry();
    registerFixtures(panels);
    panels.open("alpha", { focus: false });
    render(
      <div>
        <QaPanelHost panels={panels} sessionId={null} renderSlot={slotRenderer()} />
      </div>,
    );
    const aside = screen.getByRole("complementary", { name: "Панель: Alpha" });
    expect(aside.dataset.presentation).toBe("fullscreen");
    fireEvent.keyDown(aside, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("isolates a crashing extension from the shell", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const panels = new QaSurfacePanelRegistry();
    panels.register({ id: "crash", kind: "crash", title: () => "Crash" });
    panels.open("crash", { focus: false });
    function Crash(): ReactNode {
      throw new Error("fixture crash");
    }
    const suppress = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", suppress);
    render(
      <div>
        <QaPanelHost
          panels={panels}
          sessionId="session-a"
          renderSlot={slotRenderer(() => <Crash />)}
        />
      </div>,
    );
    window.removeEventListener("error", suppress);
    expect(screen.getByRole("alert").textContent).toMatch(/crash.*недоступна/u);
  });

  it("clamps pointer and keyboard resizing to panel and chat constraints", () => {
    expect(clampQaPanelWidth(100, 1200)).toBe(320);
    expect(clampQaPanelWidth(1000, 1200)).toBe(795);
    expect(clampQaPanelWidth(600, 900)).toBe(495);
  });
});
