// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QaSidebar } from "../../../src/client/components/QaSidebar.js";
import {
  clampQaSidebarWidth,
  QA_SIDEBAR_DEFAULT_WIDTH,
  QA_SIDEBAR_MAX_WIDTH,
  QA_SIDEBAR_MIN_WIDTH,
  resolveQaSidebarWidth,
} from "../../../src/client/components/QaWidthHandle.js";

const STATE_KEY = "dsh-qa-surface.session:v1:/qa";
const WIDTH_KEY = `${STATE_KEY}:sidebar-width`;

function renderSidebar() {
  return render(
    <QaSidebar
      rows={[]}
      title="DeepSeek QA"
      logoUrl={null}
      stateKey={STATE_KEY}
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );
}

/**
 * jsdom has no pointer capture or animation frames: stub both the way
 * qa-width-handle.test.tsx does, and hand back a flushed drag sequence.
 */
function stageDrag(handle: HTMLElement) {
  let captured = false;
  let animationFrame: FrameRequestCallback | undefined;
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      animationFrame = callback;
      return 1;
    });
  const cancelFrame = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => undefined);
  Object.defineProperties(handle, {
    setPointerCapture: {
      value: vi.fn(() => {
        captured = true;
      }),
    },
    hasPointerCapture: { value: vi.fn(() => captured) },
    releasePointerCapture: {
      value: vi.fn(() => {
        captured = false;
      }),
    },
  });
  const pointerEvent = (type: string, clientX: number, button = 0): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: 7 },
      clientX: { value: clientX },
      button: { value: button },
    });
    return event;
  };
  return {
    pointerEvent,
    flush: () => animationFrame?.(0),
    done: () => {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    },
  };
}

describe("QA sidebar resize", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("clamps drags to the DSH frame bounds as integer pixels", () => {
    expect(clampQaSidebarWidth(263.6)).toBe(QA_SIDEBAR_MIN_WIDTH);
    expect(clampQaSidebarWidth(100)).toBe(QA_SIDEBAR_MIN_WIDTH);
    expect(clampQaSidebarWidth(420.4)).toBe(QA_SIDEBAR_MAX_WIDTH);
    expect(clampQaSidebarWidth(1_000)).toBe(QA_SIDEBAR_MAX_WIDTH);
    expect(clampQaSidebarWidth(337.2)).toBe(337);
    expect(resolveQaSidebarWidth(null)).toBe(QA_SIDEBAR_DEFAULT_WIDTH);
    expect(resolveQaSidebarWidth(9_000)).toBe(QA_SIDEBAR_MAX_WIDTH);
  });

  it("publishes the stored width on mount and the default without one", () => {
    const fresh = renderSidebar();
    expect(
      screen
        .getByTestId("qa-surface-sidebar")
        .style.getPropertyValue("--dsh-qa-sidebar-width"),
    ).toBe("264px");
    fresh.unmount();

    window.localStorage.setItem(WIDTH_KEY, "380");
    renderSidebar();
    expect(
      screen
        .getByTestId("qa-surface-sidebar")
        .style.getPropertyValue("--dsh-qa-sidebar-width"),
    ).toBe("380px");
  });

  it("drags live, commits the final width, and restores it on the next mount", () => {
    const first = renderSidebar();
    const handle = screen.getByTestId("qa-surface-sidebar-resize");
    const nav = screen.getByTestId("qa-surface-sidebar");
    const drag = stageDrag(handle);

    fireEvent(handle, drag.pointerEvent("pointerdown", 100));
    fireEvent(handle, drag.pointerEvent("pointermove", 180));
    drag.flush();
    expect(nav.style.getPropertyValue("--dsh-qa-sidebar-width")).toBe("344px");
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();

    fireEvent(handle, drag.pointerEvent("pointerup", 160));
    drag.done();
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe("324");

    // The reload a reader notices: a fresh mount comes back at the dragged
    // width, not at the default.
    first.unmount();
    renderSidebar();
    expect(
      screen
        .getByTestId("qa-surface-sidebar")
        .style.getPropertyValue("--dsh-qa-sidebar-width"),
    ).toBe("324px");
  });

  it("stops the drag at the clamp on both sides", () => {
    renderSidebar();
    const handle = screen.getByTestId("qa-surface-sidebar-resize");
    const nav = screen.getByTestId("qa-surface-sidebar");
    const drag = stageDrag(handle);

    fireEvent(handle, drag.pointerEvent("pointerdown", 500));
    fireEvent(handle, drag.pointerEvent("pointermove", 2_000));
    drag.flush();
    expect(nav.style.getPropertyValue("--dsh-qa-sidebar-width")).toBe("420px");
    fireEvent(handle, drag.pointerEvent("pointerup", 2_000));

    fireEvent(handle, drag.pointerEvent("pointerdown", 2_000));
    fireEvent(handle, drag.pointerEvent("pointermove", -3_000));
    drag.flush();
    expect(nav.style.getPropertyValue("--dsh-qa-sidebar-width")).toBe("264px");
    fireEvent(handle, drag.pointerEvent("pointerup", -3_000));
    drag.done();
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe("264");
  });

  it("ignores drags that do not start with the primary button", () => {
    renderSidebar();
    const handle = screen.getByTestId("qa-surface-sidebar-resize");
    const nav = screen.getByTestId("qa-surface-sidebar");
    const drag = stageDrag(handle);

    fireEvent(handle, drag.pointerEvent("pointerdown", 100, 2));
    fireEvent(handle, drag.pointerEvent("pointermove", 400));
    drag.flush();
    expect(nav.style.getPropertyValue("--dsh-qa-sidebar-width")).toBe("264px");
    fireEvent(handle, drag.pointerEvent("pointerup", 400));
    drag.done();
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
  });

  it("keeps the collapsed rail fixed: no handle, restored width on expand", () => {
    window.localStorage.setItem(`${STATE_KEY}:sidebar-collapsed`, "1");
    window.localStorage.setItem(WIDTH_KEY, "400");
    renderSidebar();
    expect(screen.getByTestId("qa-surface-sidebar-collapsed")).toBeTruthy();
    expect(screen.queryByTestId("qa-surface-sidebar-resize")).toBeNull();

    fireEvent.click(screen.getByTestId("qa-surface-sidebar-expand"));
    const nav = screen.getByTestId("qa-surface-sidebar");
    expect(nav).toBeTruthy();
    expect(screen.getByTestId("qa-surface-sidebar-resize")).toBeTruthy();
    expect(nav.style.getPropertyValue("--dsh-qa-sidebar-width")).toBe("400px");
  });
});
