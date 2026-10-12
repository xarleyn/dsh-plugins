// @vitest-environment jsdom
import { useRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QaRightRailResize,
  resolveQaRightRailWidth,
} from "../../../src/client/components/QaRightRailResize.js";

function storage(value: string | null = null) {
  const entries = new Map<string, string>();
  if (value !== null) entries.set("rail", value);
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, next: string) => {
      entries.set(key, next);
    },
  };
}
function Harness({ store }: { store: ReturnType<typeof storage> }) {
  const root = useRef<HTMLElement>(null);
  return (
    <main
      ref={(node) => {
        if (node)
          Object.defineProperty(node, "clientWidth", {
            value: 1400,
            configurable: true,
          });
      }}
    >
      <nav
        className="dsh-qa-sidebar"
        ref={(node) => {
          if (node)
            Object.defineProperty(node, "offsetWidth", {
              value: 264,
              configurable: true,
            });
        }}
      />
      <aside ref={root} data-testid="panel">
        <QaRightRailResize root={root} storage={store} storageKey="rail" />
      </aside>
    </main>
  );
}
function pointer(type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    button: { value: 0 },
    clientX: { value: x },
  });
  return event;
}
afterEach(() => vi.restoreAllMocks());

describe("right-panel resize", () => {
  it("keeps room for the conversation and bounds large saved sizes", () => {
    expect(resolveQaRightRailWidth(null, 1136)).toBe(360);
    expect(resolveQaRightRailWidth(900, 1136)).toBe(720);
    expect(resolveQaRightRailWidth(600, 636)).toBe(316);
    expect(resolveQaRightRailWidth(100, 1136)).toBe(280);
  });
  it("widens when dragged left, persists the release position, and cancels previews", () => {
    const store = storage();
    const mounted = render(<Harness store={store} />);
    const handle = screen.getByRole("separator", {
        name: "Ширина правой панели",
      }),
      panel = screen.getByTestId("panel");
    let captured = false,
      frame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
      frame = fn;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperties(handle, {
      setPointerCapture: {
        value: () => {
          captured = true;
        },
      },
      hasPointerCapture: { value: () => captured },
      releasePointerCapture: {
        value: () => {
          captured = false;
        },
      },
    });
    fireEvent(handle, pointer("pointerdown", 900));
    fireEvent(handle, pointer("pointermove", 780));
    act(() => frame?.(0));
    expect(panel.style.getPropertyValue("--dsh-qa-panel-width")).toBe("480px");
    expect(store.getItem("rail")).toBeNull();
    fireEvent(handle, pointer("pointerup", 760));
    expect(store.getItem("rail")).toBe("500");
    fireEvent(handle, pointer("pointerdown", 900));
    fireEvent(handle, pointer("pointermove", 600));
    act(() => frame?.(0));
    fireEvent.pointerCancel(handle);
    expect(panel.style.getPropertyValue("--dsh-qa-panel-width")).toBe("500px");
    expect(handle.getAttribute("aria-valuenow")).toBe("500");
    expect(store.getItem("rail")).toBe("500");
    mounted.unmount();
    render(<Harness store={store} />);
    expect(
      screen
        .getByTestId("panel")
        .style.getPropertyValue("--dsh-qa-panel-width"),
    ).toBe("500px");
  });
  it("answers keyboard controls and remains resizable when storage is denied", () => {
    const store = {
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("denied");
      },
    };
    render(<Harness store={store} />);
    const handle = screen.getByRole("separator"),
      panel = screen.getByTestId("panel");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(panel.style.getPropertyValue("--dsh-qa-panel-width")).toBe("376px");
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(handle.getAttribute("aria-valuenow")).toBe("416");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("720");
  });
});
