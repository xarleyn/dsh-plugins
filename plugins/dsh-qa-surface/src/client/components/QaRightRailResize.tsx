import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { readQaStoredWidth, writeQaStoredWidth } from "./QaWidthHandle.js";

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;
const CHAT_MIN_WIDTH = 320;

export function resolveQaRightRailWidth(
  requested: number | null,
  available: number,
) {
  const maximum = Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, available - CHAT_MIN_WIDTH),
  );
  return Math.round(
    Math.max(MIN_WIDTH, Math.min(requested ?? DEFAULT_WIDTH, maximum)),
  );
}

/** A one-sided border drag: moving left widens the panel on the right. */
export function QaRightRailResize(props: {
  root: RefObject<HTMLElement | null>;
  storage: Pick<Storage, "getItem" | "setItem">;
  storageKey: string;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(MAX_WIDTH);
  const [dragging, setDragging] = useState(false);
  const liveDrag = useRef(false);
  const origin = useRef(0);
  const base = useRef(DEFAULT_WIDTH);
  const latest = useRef(DEFAULT_WIDTH);
  const frame = useRef<number | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  const panel = useCallback(
    () => props.root.current ?? handle.current?.parentElement,
    [props.root],
  );
  const preference = useRef(readQaStoredWidth(props.storage, props.storageKey));
  const available = useCallback(() => {
    const parent = panel()?.parentElement;
    if (!parent || parent.clientWidth === 0) return MAX_WIDTH + CHAT_MIN_WIDTH;
    const occupied = [...parent.children]
      .filter((el) => el.matches(".dsh-qa-sidebar,.dsh-qa-agents"))
      .reduce((sum, el) => sum + (el as HTMLElement).offsetWidth, 0);
    return parent.clientWidth - occupied;
  }, [panel]);
  const publish = useCallback(() => {
    if (liveDrag.current) return;
    const space = available();
    const resolved = resolveQaRightRailWidth(preference.current, space);
    panel()?.style.setProperty("--dsh-qa-panel-width", `${resolved}px`);
    setWidth(resolved);
    handle.current?.setAttribute("aria-valuenow", String(resolved));
    setMaximum(resolveQaRightRailWidth(MAX_WIDTH, space));
  }, [available, panel]);
  useLayoutEffect(() => {
    preference.current = readQaStoredWidth(props.storage, props.storageKey);
    publish();
    const parent = panel()?.parentElement;
    if (!parent) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => window.removeEventListener("resize", publish);
    }
    const observer = new ResizeObserver(publish);
    observer.observe(parent);
    for (const child of parent.children)
      if (child.matches(".dsh-qa-sidebar,.dsh-qa-body"))
        observer.observe(child);
    return () => observer.disconnect();
  }, [panel, props.storage, props.storageKey, publish]);
  const cancelFrame = useCallback(() => {
    if (frame.current === null) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  useEffect(() => cancelFrame, [cancelFrame]);
  const preview = (requested: number) => {
    const resolved = resolveQaRightRailWidth(requested, available());
    panel()?.style.setProperty("--dsh-qa-panel-width", `${resolved}px`);
    handle.current?.setAttribute("aria-valuenow", String(resolved));
    return resolved;
  };
  const commit = (requested: number) => {
    preference.current = preview(requested);
    writeQaStoredWidth(props.storage, props.storageKey, preference.current);
    liveDrag.current = false;
    setDragging(false);
    publish();
  };
  const cancel = () => {
    cancelFrame();
    liveDrag.current = false;
    setDragging(false);
    publish();
  };
  return (
    <div
      ref={handle}
      className="dsh-qa-panel__resize"
      data-testid="qa-surface-rail-resize"
      data-dragging={dragging || undefined}
      role="separator"
      tabIndex={0}
      aria-label="Ширина правой панели"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maximum}
      aria-valuenow={width}
      title="Потяните границу, чтобы изменить ширину панели"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        base.current = panel()?.getBoundingClientRect().width || width;
        origin.current = event.clientX;
        latest.current = base.current;
        liveDrag.current = true;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        latest.current = base.current + origin.current - event.clientX;
        frame.current ??= requestAnimationFrame(() => {
          frame.current = null;
          preview(latest.current);
        });
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        cancelFrame();
        commit(base.current + origin.current - event.clientX);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 16;
        const requested =
          event.key === "ArrowLeft"
            ? width + step
            : event.key === "ArrowRight"
              ? width - step
              : event.key === "Home"
                ? MIN_WIDTH
                : event.key === "End"
                  ? maximum
                  : null;
        if (requested === null) return;
        event.preventDefault();
        commit(requested);
      }}
    />
  );
}
