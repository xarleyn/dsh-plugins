import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

/** DSH's dragged content-width floor; a lower operator cap still wins. */
export const QA_CONTENT_MIN_WIDTH = 640;

/**
 * Space kept outside the content: 88px per side leaves room for the handle,
 * its inset, and a safe zone that remains draggable in both directions.
 */
export const QA_CONTENT_EDGE_BUDGET = 176;

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

/** Resolve the centered content width for the currently available column. */
export function resolveQaContentWidth(
  columnWidth: number,
  preference: number | null,
  maxContentWidth: number,
): number {
  const available = Math.max(0, columnWidth - QA_CONTENT_EDGE_BUDGET);
  const maximum = Math.min(maxContentWidth, available);
  const minimum = Math.min(QA_CONTENT_MIN_WIDTH, maximum);
  const adaptive = Math.min(
    maxContentWidth,
    Math.max(
      QA_ADAPTIVE_MIN_WIDTH,
      Math.min(columnWidth * 0.64, QA_ADAPTIVE_MAX_WIDTH),
    ),
  );
  const requested = preference ?? adaptive;
  return Math.min(Math.max(requested, minimum), maximum);
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
  readonly maxContentWidth: number;
}

export function useQaContentWidth({
  active,
  root,
  storage,
  storageKey,
  maxContentWidth,
}: UseQaContentWidthOptions) {
  const publish = useCallback(() => {
    const element = root.current;
    if (element === null) return;
    const preference = readQaContentWidth(storage, storageKey);
    const width = resolveQaContentWidth(
      element.offsetWidth,
      preference,
      maxContentWidth,
    );
    element.style.setProperty("--dsh-qa-content-width", `${width}px`);
  }, [maxContentWidth, root, storage, storageKey]);

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
    if (element === null) return maxContentWidth;
    return resolveQaContentWidth(
      element.offsetWidth,
      readQaContentWidth(storage, storageKey),
      maxContentWidth,
    );
  }, [maxContentWidth, root, storage, storageKey]);

  const onDrag = useCallback(
    (requestedWidth: number) => {
      const element = root.current;
      if (element === null) return;
      const width = resolveQaContentWidth(
        element.offsetWidth,
        requestedWidth,
        maxContentWidth,
      );
      element.style.setProperty("--dsh-qa-content-width", `${width}px`);
    },
    [maxContentWidth, root],
  );

  const onCommit = useCallback(
    (requestedWidth: number) => {
      const element = root.current;
      if (element === null) return;
      const width = resolveQaContentWidth(
        element.offsetWidth,
        requestedWidth,
        maxContentWidth,
      );
      writeQaContentWidth(storage, storageKey, width);
    },
    [maxContentWidth, root, storage, storageKey],
  );

  return { onStart, onDrag, onCommit, onEnd: publish } as const;
}
