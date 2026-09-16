import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

/**
 * Space kept outside the content: 88px per side leaves room for the handle,
 * its inset, and a safe zone that remains draggable in both directions. It is
 * the whole ceiling too: like DSH, the page bounds the width, so a wide column
 * lets the transcript fill it.
 */
export const QA_CONTENT_EDGE_BUDGET = 176;

/**
 * Band between the text column edge and the handle strip: the transcript keeps
 * 16px of side padding and the strip's inner edge sits 24px outside the content
 * box. A bled block that grows past this band slides under the 40px drag
 * target, so the stylesheet holds the bleed inside it.
 */
export const QA_HANDLE_FREE_BAND = 40;

/**
 * Ceiling for the assistant bleed (fenced code blocks) per side. Eight pixels
 * short of the free band, so both the strip and its glow stay on empty gutter
 * at every width; the stylesheet caps it once more by the live side gutter.
 */
export const QA_BLEED_MAX_WIDTH = QA_HANDLE_FREE_BAND - 8;

const QA_ADAPTIVE_MIN_WIDTH = 680;
const QA_ADAPTIVE_MAX_WIDTH = 920;

export function readQaContentWidth(
  storage: Pick<Storage, "getItem">,
  key: string,
): number | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeQaContentWidth(
  storage: Pick<Storage, "setItem">,
  key: string,
  width: number,
): void {
  try {
    storage.setItem(key, `${width}`);
  } catch {
    // Denied durable storage only costs persistence across reloads.
  }
}

/**
 * Resolve the centered content width for the currently available column. The
 * operator sets only the floor; the column is the ceiling, so the content may
 * grow until its handles reach the edge budget and a wider window keeps
 * widening it. A column too narrow even for the floor wins over the floor —
 * there is nothing else to give up.
 */
export function resolveQaContentWidth(
  columnWidth: number,
  preference: number | null,
  minContentWidth: number,
): number {
  const available = Math.max(0, columnWidth - QA_CONTENT_EDGE_BUDGET);
  const minimum = Math.min(minContentWidth, available);
  const adaptive = Math.max(
    QA_ADAPTIVE_MIN_WIDTH,
    Math.min(columnWidth * 0.64, QA_ADAPTIVE_MAX_WIDTH),
  );
  const requested = preference ?? Math.max(adaptive, minimum);
  return Math.min(Math.max(requested, minimum), available);
}

interface QaWidthHandleProps {
  readonly side: "left" | "right";
  readonly onStart: () => number;
  readonly onDrag: (width: number) => void;
  readonly onCommit: (width: number) => void;
  readonly onEnd: () => void;
}

/** Pointer-captured, rAF-throttled symmetric content-width handle. */
export function QaWidthHandle(props: QaWidthHandleProps) {
  const [dragging, setDragging] = useState(false);
  const base = useRef(0);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  const outwardWidth = () => {
    const delta = latest.current - origin.current;
    const outward = callbacks.current.side === "right" ? delta : -delta;
    return base.current + outward * 2;
  };

  const cancelFrame = useCallback(() => {
    if (frame.current === null) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = event.clientX;
    latest.current = event.clientX;
    base.current = callbacks.current.onStart();
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--dsh-qa-width-handle-pointer-y",
      `${event.clientY - box.top}px`,
    );
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    latest.current = event.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(outwardWidth());
    });
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      cancelFrame();
      latest.current = event.clientX;
      if (latest.current !== origin.current) {
        callbacks.current.onCommit(outwardWidth());
      }
      setDragging(false);
      callbacks.current.onEnd();
    },
    [cancelFrame],
  );

  const onPointerCancel = useCallback(() => {
    cancelFrame();
    setDragging(false);
    callbacks.current.onEnd();
  }, [cancelFrame]);

  return (
    <div
      className="dsh-qa-width-handle"
      data-side={props.side}
      data-width-handle={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  );
}

interface UseQaContentWidthOptions {
  readonly active: boolean;
  readonly root: RefObject<HTMLDivElement | null>;
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly storageKey: string;
  readonly minContentWidth: number;
}

export function useQaContentWidth({
  active,
  root,
  storage,
  storageKey,
  minContentWidth,
}: UseQaContentWidthOptions) {
  /**
   * Publish both numbers the layout needs: the resolved content width and the
   * column it sits in. The stylesheet derives the side gutter from the pair and
   * caps the assistant bleed with it, which keeps bled blocks off the handle.
   */
  const publish = useCallback(() => {
    const element = root.current;
    if (element === null) return;
    const column = element.offsetWidth;
    const preference = readQaContentWidth(storage, storageKey);
    const width = resolveQaContentWidth(column, preference, minContentWidth);
    element.style.setProperty("--dsh-qa-column-width", `${column}px`);
    element.style.setProperty("--dsh-qa-content-width", `${width}px`);
  }, [minContentWidth, root, storage, storageKey]);

  useLayoutEffect(() => {
    if (!active) return;
    const element = root.current;
    if (element === null) return;
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, publish, root]);

  const onStart = useCallback(() => {
    const element = root.current;
    if (element === null) return minContentWidth;
    return resolveQaContentWidth(
      element.offsetWidth,
      readQaContentWidth(storage, storageKey),
      minContentWidth,
    );
  }, [minContentWidth, root, storage, storageKey]);

  const onDrag = useCallback(
    (requestedWidth: number) => {
      const element = root.current;
      if (element === null) return;
      const width = resolveQaContentWidth(
        element.offsetWidth,
        requestedWidth,
        minContentWidth,
      );
      element.style.setProperty("--dsh-qa-content-width", `${width}px`);
    },
    [minContentWidth, root],
  );

  const onCommit = useCallback(
    (requestedWidth: number) => {
      const element = root.current;
      if (element === null) return;
      const width = resolveQaContentWidth(
        element.offsetWidth,
        requestedWidth,
        minContentWidth,
      );
      writeQaContentWidth(storage, storageKey, width);
    },
    [minContentWidth, root, storage, storageKey],
  );

  return { onStart, onDrag, onCommit, onEnd: publish } as const;
}

export type UseQaContentWidthResult = ReturnType<typeof useQaContentWidth>;
