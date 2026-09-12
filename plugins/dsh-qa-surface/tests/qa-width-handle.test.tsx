// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QaWidthHandle,
  readQaContentWidth,
  resolveQaContentWidth,
  writeQaContentWidth,
} from "../src/client/components/QaWidthHandle.js";

describe("QA content width", () => {
  it("uses the DSH adaptive width and clamps persisted preferences", () => {
    expect(resolveQaContentWidth(1_000, null, 900)).toBe(680);
    expect(resolveQaContentWidth(1_440, null, 900)).toBe(900);
    expect(resolveQaContentWidth(1_000, 400, 900)).toBe(640);
    expect(resolveQaContentWidth(1_000, 400, 600)).toBe(600);
    expect(resolveQaContentWidth(1_000, 1_200, 900)).toBe(824);
  });

  it("tolerates unavailable or corrupt durable storage", () => {
    expect(
      readQaContentWidth({ getItem: () => "not-a-number" }, "width"),
    ).toBeNull();
    expect(
      readQaContentWidth(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        "width",
      ),
    ).toBeNull();
    expect(() =>
      writeQaContentWidth(
        {
          setItem: () => {
            throw new Error("denied");
          },
        },
        "width",
        720,
      ),
    ).not.toThrow();
  });

  it("renders the same two-sided resize affordance as DSH", () => {
    const handlers = {
      onStart: vi.fn(() => 680),
      onDrag: vi.fn(),
      onCommit: vi.fn(),
      onEnd: vi.fn(),
    };
    const { container } = render(
      <>
        <QaWidthHandle side="left" {...handlers} />
        <QaWidthHandle side="right" {...handlers} />
      </>,
    );
    expect(container.querySelector('[data-width-handle="left"]')).toBeTruthy();
    expect(container.querySelector('[data-width-handle="right"]')).toBeTruthy();
  });

  it("resizes symmetrically and commits the final width", () => {
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
    const handlers = {
      onStart: vi.fn(() => 680),
      onDrag: vi.fn(),
      onCommit: vi.fn(),
      onEnd: vi.fn(),
    };
    const { container } = render(<QaWidthHandle side="right" {...handlers} />);
    const handle = container.querySelector<HTMLElement>(
      '[data-width-handle="right"]',
    );
    expect(handle).not.toBeNull();
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
      getBoundingClientRect: {
        value: vi.fn(() => ({ top: 10 })),
      },
    });

    const pointerEvent = (
      type: string,
      clientX: number,
      clientY = 0,
    ): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        clientX: { value: clientX },
        clientY: { value: clientY },
      });
      return event;
    };

    fireEvent(handle!, pointerEvent("pointerdown", 100));
    fireEvent(handle!, pointerEvent("pointermove", 120, 90));
    animationFrame?.(0);
    expect(handlers.onDrag).toHaveBeenCalledWith(720);
    expect(
      handle?.style.getPropertyValue("--dsh-qa-width-handle-pointer-y"),
    ).toBe("80px");

    fireEvent(handle!, pointerEvent("pointerup", 130));
    expect(handlers.onCommit).toHaveBeenCalledWith(740);
    expect(handlers.onEnd).toHaveBeenCalledOnce();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});
