// @vitest-environment jsdom

import { useRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QaWidthHandle,
  readQaStoredWidth,
  resolveQaContentWidth,
  useQaContentWidth,
  writeQaStoredWidth,
  type UseQaContentWidthResult,
} from "../src/client/components/QaWidthHandle.js";

/** In-memory stand-in for the browser storage the hook persists into. */
function memoryStorage(initial?: string) {
  const entries = new Map<string, string>();
  if (initial !== undefined) entries.set("qa:content-width", initial);
  return {
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
  };
}

type StorageStub = ReturnType<typeof memoryStorage>;

/** Renders the hook against a fixed-width column and exposes its handlers. */
function WidthHarness(props: {
  readonly column: number;
  readonly min: number;
  readonly storage: StorageStub;
  readonly handlers: { current: UseQaContentWidthResult | null };
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const published = useQaContentWidth({
    active: true,
    root,
    storage: props.storage,
    storageKey: "qa:content-width",
    minContentWidth: props.min,
  });
  props.handlers.current = published;
  return (
    <div
      ref={(node) => {
        root.current = node;
        // jsdom has no layout: the column width is the fixture.
        if (node !== null) {
          Object.defineProperty(node, "offsetWidth", {
            value: props.column,
            configurable: true,
          });
        }
      }}
    />
  );
}

describe("QA content width", () => {
  it("uses the DSH adaptive width and clamps persisted preferences", () => {
    expect(resolveQaContentWidth(1_000, null, 650)).toBe(680);
    expect(resolveQaContentWidth(1_440, null, 650)).toBe(920);
    expect(resolveQaContentWidth(1_000, 400, 650)).toBe(650);
    expect(resolveQaContentWidth(1_000, 400, 600)).toBe(600);
    expect(resolveQaContentWidth(1_000, 1_200, 650)).toBe(824);
  });

  // The floor is the only operator bound: upward travel stops at the column,
  // not at a configured cap, so a wide page lets the transcript fill it.
  it("lets a dragged width grow to the column edge budget", () => {
    expect(resolveQaContentWidth(1_440, 1_800, 650)).toBe(1_264);
    expect(resolveQaContentWidth(2_400, 2_400, 650)).toBe(2_224);
  });

  // A column that cannot hold the floor wins over the floor: there is no
  // other space to take, and the handles must stay reachable.
  it("yields to a column narrower than the floor", () => {
    expect(resolveQaContentWidth(700, null, 650)).toBe(524);
    expect(resolveQaContentWidth(700, 900, 650)).toBe(524);
  });

  it("starts at the floor when the operator raises it past the adaptive width", () => {
    expect(resolveQaContentWidth(1_440, null, 1_100)).toBe(1_100);
  });

  it("tolerates unavailable or corrupt durable storage", () => {
    expect(
      readQaStoredWidth({ getItem: () => "not-a-number" }, "width"),
    ).toBeNull();
    expect(
      readQaStoredWidth(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        "width",
      ),
    ).toBeNull();
    expect(() =>
      writeQaStoredWidth(
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

  describe("applied to the surface", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("publishes the configured floor and grows past the old cap on a drag", () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe(): void {}
          disconnect(): void {}
        },
      );
      const handlers: { current: UseQaContentWidthResult | null } = {
        current: null,
      };
      const storage = memoryStorage();
      const { container } = render(
        <WidthHarness
          column={1_440}
          min={650}
          storage={storage}
          handlers={handlers}
        />,
      );
      const root = container.firstElementChild as HTMLElement;
      // Adaptive default for a wide column, as DSH resolves it.
      expect(root.style.getPropertyValue("--dsh-qa-content-width")).toBe(
        "920px",
      );
      // The column itself rides along: the stylesheet caps the assistant bleed
      // by the gutter this pair describes.
      expect(root.style.getPropertyValue("--dsh-qa-column-width")).toBe(
        "1440px",
      );

      // 1_600px exceeds the removed 900px cap and stops at the column budget.
      handlers.current?.onDrag(1_600);
      expect(root.style.getPropertyValue("--dsh-qa-content-width")).toBe(
        "1264px",
      );
      handlers.current?.onCommit(1_600);
      expect(storage.getItem("qa:content-width")).toBe("1264");
    });

    it("raises a persisted narrow width back to the floor", () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe(): void {}
          disconnect(): void {}
        },
      );
      const handlers: { current: UseQaContentWidthResult | null } = {
        current: null,
      };
      const { container } = render(
        <WidthHarness
          column={1_000}
          min={650}
          storage={memoryStorage("400")}
          handlers={handlers}
        />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.getPropertyValue("--dsh-qa-content-width")).toBe(
        "650px",
      );
      expect(handlers.current?.onStart()).toBe(650);
    });

    // The reload a reader notices: the width committed before it must come
    // back as-is, not fall back to the adaptive default.
    it("restores a committed width on the next mount, as after a reload", () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe(): void {}
          disconnect(): void {}
        },
      );
      const { container } = render(
        <WidthHarness
          column={1_200}
          min={650}
          storage={memoryStorage("760")}
          handlers={{ current: null }}
        />,
      );
      expect(
        (container.firstElementChild as HTMLElement).style.getPropertyValue(
          "--dsh-qa-content-width",
        ),
      ).toBe("760px");
    });
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
