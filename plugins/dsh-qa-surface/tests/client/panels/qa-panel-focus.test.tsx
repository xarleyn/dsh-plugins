// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QaPanelHost,
  type QaPanelHostProps,
} from "../../../src/client/panels/PanelHost.js";
import { QaModal } from "../../../src/client/components/QaModal.js";
import { QaSurfacePanelRegistry } from "../../../src/client/panels/registry.js";

const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  let next = 0;
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  frames.clear();
});
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(performance.now());
  });
}
function fixture(modalOpen = false, onClose = vi.fn()) {
  const panels = new QaSurfacePanelRegistry();
  panels.register({ id: "demo-panel", kind: "demo", title: () => "Demo" });
  const renderSlot = (() => (
    <input aria-label="Panel field" />
  )) as QaPanelHostProps["renderSlot"];
  const view = (open: boolean) => (
    <>
      <button type="button">Panel opener</button>
      <input aria-label="Outside field" />
      <textarea id="dsh-qa-prompt" aria-label="Chat draft" />
      <QaPanelHost
        panels={panels}
        sessionId="demo-chat"
        renderSlot={renderSlot}
      />
      <QaModal
        open={open}
        title="Demo dialog"
        closeLabel="Close demo dialog"
        onClose={onClose}
      >
        <input aria-label="Dialog field" />
      </QaModal>
    </>
  );
  const mounted = render(view(modalOpen));
  return { panels, mounted, view, onClose };
}

describe("deferred panel focus ownership", () => {
  it("keeps explicit panel autofocus and restores the opener when no one takes focus", () => {
    const { panels } = fixture();
    const opener = screen.getByRole("button", { name: "Panel opener" });
    opener.focus();
    act(() => void panels.open("demo", { focus: true }));
    flushFrames();
    expect(document.activeElement).toBe(screen.getByTestId("qa-panel-close"));
    act(() => panels.close({ reason: "user" }));
    flushFrames();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps an input selected after the panel focus frame was queued", () => {
    const { panels } = fixture();
    act(() => void panels.open("demo", { focus: true }));
    const field = screen.getByLabelText("Outside field");
    field.focus();
    flushFrames();
    expect(document.activeElement).toBe(field);
  });

  it("keeps a new input selected before close restoration runs", () => {
    const { panels } = fixture();
    screen.getByRole("button", { name: "Panel opener" }).focus();
    act(() => void panels.open("demo", { focus: true }));
    flushFrames();
    act(() => panels.close({ reason: "user" }));
    const field = screen.getByLabelText("Outside field");
    field.focus();
    flushFrames();
    expect(document.activeElement).toBe(field);
  });

  it("does not restore an opener after a background panel is closed beside an edited field", () => {
    const { panels } = fixture();
    screen.getByRole("button", { name: "Panel opener" }).focus();
    act(() => void panels.open("demo", { focus: true }));
    flushFrames();
    const field = screen.getByLabelText("Outside field");
    field.focus();
    act(() => panels.close({ reason: "extension" }));
    flushFrames();
    expect(document.activeElement).toBe(field);
  });

  it("leaves an open dialog in charge of queued panel autofocus and close restoration", () => {
    const { panels, mounted, view } = fixture();
    screen.getByRole("button", { name: "Panel opener" }).focus();
    act(() => void panels.open("demo", { focus: true }));
    mounted.rerender(view(true));
    const field = screen.getByLabelText("Dialog field");
    field.focus();
    flushFrames();
    expect(document.activeElement).toBe(field);
    act(() => panels.close({ reason: "extension" }));
    flushFrames();
    expect(document.activeElement).toBe(field);
  });

  it("does not autofocus a background panel even when its request starts inside a modal lifetime", () => {
    const { panels } = fixture(true);
    const field = screen.getByLabelText("Dialog field");
    field.focus();
    act(() => void panels.open("demo", { focus: true }));
    flushFrames();
    expect(document.activeElement).toBe(field);
  });

  it("lets a modal nested in a fullscreen panel own Escape", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });
    const panels = new QaSurfacePanelRegistry();
    const close = vi.fn();
    panels.register({ id: "demo-panel", kind: "demo", title: () => "Demo" });
    const renderSlot = (() => (
      <QaModal
        open
        title="Nested demo dialog"
        closeLabel="Close nested demo dialog"
        onClose={close}
      >
        <input aria-label="Nested dialog field" />
      </QaModal>
    )) as QaPanelHostProps["renderSlot"];
    render(
      <QaPanelHost
        panels={panels}
        sessionId="demo-chat"
        renderSlot={renderSlot}
      />,
    );
    act(() => void panels.open("demo", { focus: false }));
    const field = screen.getByLabelText("Nested dialog field");
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByTestId("qa-panel")).toBeTruthy();
  });
});
