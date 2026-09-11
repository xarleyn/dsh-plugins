import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { QaMessage } from "../../types.js";

/**
 * One mark of the turn rail: the user prompt that opens the turn, a bounded
 * answer preview for the hover tooltip, and the message id that anchors the
 * jump (the prompt's message slot in the transcript).
 */
export interface QaTurnRailItem {
  /** 1-based position in the visible transcript; also the React key. */
  readonly turn: number;
  /** The user message id that opens the turn (scroll anchor). */
  readonly id: string;
  readonly prompt: string;
  readonly response: string;
}

/** Transcript attribute marking the message slot that opens a turn. */
export const QA_TURN_ANCHOR_ATTRIBUTE = "data-dsh-qa-turn-anchor";

/** Scroll distance from the floor at which the rail still calls it "at bottom". */
export const QA_TURN_FOLLOW_PX = 96;
/** The reading line: reading offset from the scrollport top while scrolling. */
export const QA_TURN_READING_PX = 96;
/** Where a jump lands its prompt row, mirroring the harness chat rail. */
const QA_TURN_LAND_PX = 24;

const PROMPT_CLIP = 140;
const RESPONSE_CLIP = 220;

function clipPreview(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Rail ladder of the visible transcript: every user prompt opens a turn, the
 * first non-empty answer after it fills the response preview. Hidden variant
 * answers never reach this list because callers pass the already-filtered
 * messages.
 */
export function buildTurnRailItems(
  messages: readonly QaMessage[],
): readonly QaTurnRailItem[] {
  const items: QaTurnRailItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        turn: items.length + 1,
        id: message.id,
        prompt: clipPreview(message.text, PROMPT_CLIP),
        response: "",
      });
      continue;
    }
    if (message.role !== "assistant" || items.length === 0) continue;
    const current = items.at(-1);
    if (current === undefined || current.response !== "") continue;
    const response = clipPreview(message.text, RESPONSE_CLIP);
    if (response !== "") items[items.length - 1] = { ...current, response };
  }
  return items;
}

/** Deep equality guard so the memoized rail skips streaming commits. */
export function sameTurnRailItems(
  left: readonly QaTurnRailItem[],
  right: readonly QaTurnRailItem[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      item.turn === other.turn &&
      item.id === other.id &&
      item.prompt === other.prompt &&
      item.response === other.response
    );
  });
}

/**
 * Turn owning the transcript's reading line, or the newest one while the
 * reader follows the live tail. Anchors above the line are scanned in flow
 * order; the last one at or above it owns the mark.
 */
export function computeActiveTurn(
  scroller: HTMLElement,
  items: readonly QaTurnRailItem[],
): number | null {
  if (items.length === 0) return null;
  const last = items.at(-1);
  if (last === undefined) return null;
  if (
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
    QA_TURN_FOLLOW_PX + 1
  ) {
    return last.turn;
  }
  const line =
    scroller.getBoundingClientRect().top +
    Math.min(QA_TURN_READING_PX, scroller.clientHeight * 0.2);
  const turnByAnchor = new Map(
    items.map((item) => [item.id, item.turn] as const),
  );
  const first = items[0];
  if (first === undefined) return null;
  let next = first.turn;
  for (const row of scroller.querySelectorAll<HTMLElement>(
    `[${QA_TURN_ANCHOR_ATTRIBUTE}]`,
  )) {
    if (row.getBoundingClientRect().top > line) break;
    const turn = turnByAnchor.get(
      row.getAttribute(QA_TURN_ANCHOR_ATTRIBUTE) ?? "",
    );
    if (turn !== undefined) next = turn;
  }
  return next;
}

/** Fixed pitch between neighbouring marks; overflow scrolls inside the frame. */
const TURN_SPACING_PX = 10;
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6;
/** Fade band the mask reserves at a scrollable end. */
const FADE_PX = 24;

/** Scroll state the mask fades and follow logic read together. */
interface RailScrollState {
  readonly top: number;
  readonly canScrollUp: boolean;
  readonly canScrollDown: boolean;
}

const RAIL_AT_REST: RailScrollState = {
  top: 0,
  canScrollUp: false,
  canScrollDown: false,
};

export interface QaTurnRailProps {
  readonly items: readonly QaTurnRailItem[];
  readonly activeTurn: number | null;
  /** Turn still generating; its mark pulses. */
  readonly busyTurn: number | null;
  /** The transcript scroller the rail floats over and measures its band from. */
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  readonly onNavigate: (item: QaTurnRailItem) => void;
}

function railScrollState(scroller: HTMLElement): RailScrollState {
  const top = scroller.scrollTop;
  return {
    top,
    canScrollUp: top > 1,
    canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1,
  };
}

function sameRailScrollState(
  left: RailScrollState,
  right: RailScrollState,
): boolean {
  return (
    left.top === right.top &&
    left.canScrollUp === right.canScrollUp &&
    left.canScrollDown === right.canScrollDown
  );
}

function itemAtPointer(
  items: readonly QaTurnRailItem[],
  frame: HTMLElement,
  scrollTop: number,
  clientY: number,
): QaTurnRailItem | undefined {
  const rect = frame.getBoundingClientRect();
  const offset = clientY - rect.top + scrollTop - RAIL_INSET_PX;
  const index = Math.max(
    0,
    Math.min(items.length - 1, Math.round(offset / TURN_SPACING_PX)),
  );
  return items[index];
}

function QaTurnRailView({
  items,
  activeTurn,
  busyTurn,
  scrollerRef,
  onNavigate,
}: QaTurnRailProps) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const ladderRef = useRef<HTMLDivElement | null>(null);
  /** While the pointer works the rail, follow must not move it under the hand. */
  const pointerInsideRef = useRef(false);
  const [previewTurn, setPreviewTurn] = useState<number | null>(null);
  const [scrollState, setScrollState] = useState<RailScrollState>(RAIL_AT_REST);
  const previewId = useId();

  // The band the marks centre in is the transcript scrollport's own height;
  // publish it as a custom property so the frame can centre without knowing
  // the header/composer layout around it.
  useEffect(() => {
    const slot = slotRef.current;
    const scroller = scrollerRef.current;
    if (slot === null || scroller === null) return;
    const apply = () => {
      slot.style.setProperty(
        "--dsh-qa-rail-band",
        `${scroller.clientHeight}px`,
      );
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, [scrollerRef]);

  const syncScrollState = useCallback((): void => {
    const ladder = ladderRef.current;
    if (ladder === null) return;
    const next = railScrollState(ladder);
    setScrollState((current) =>
      sameRailScrollState(current, next) ? current : next,
    );
  }, []);

  // Frame resizes (band changes) move the overflow edges without a scroll
  // event; item count changes move the content height the same way.
  useEffect(() => {
    const ladder = ladderRef.current;
    if (ladder === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(ladder);
    return () => {
      observer.disconnect();
    };
  }, [syncScrollState]);
  useEffect(() => {
    syncScrollState();
  }, [items.length, syncScrollState]);

  // Keep the active mark visible: centre it whenever it leaves the scrollport,
  // unless the reader's pointer is working the rail.
  useEffect(() => {
    const ladder = ladderRef.current;
    const index = items.findIndex((item) => item.turn === activeTurn);
    if (ladder === null || index < 0 || pointerInsideRef.current) return;
    const markTop = index * TURN_SPACING_PX + RAIL_INSET_PX;
    const viewTop = ladder.scrollTop;
    const viewHeight = ladder.clientHeight;
    if (
      viewHeight <= 0 ||
      (markTop >= viewTop + FADE_PX &&
        markTop <= viewTop + viewHeight - FADE_PX)
    ) {
      return;
    }
    const target = Math.max(0, markTop - viewHeight / 2);
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof ladder.scrollTo === "function") {
      ladder.scrollTo({ top: target, behavior: reduced ? "auto" : "smooth" });
    } else {
      ladder.scrollTop = target;
    }
    syncScrollState();
  }, [activeTurn, items, syncScrollState]);

  if (items.length < 2) return null;
  const previewIndex = items.findIndex((item) => item.turn === previewTurn);
  const preview = previewIndex < 0 ? undefined : items[previewIndex];
  const previewPosition =
    previewIndex < 0 ? undefined : previewIndex * TURN_SPACING_PX;
  const previewAtPointer = (event: PointerEvent<HTMLElement>): void => {
    const scrollTop = ladderRef.current?.scrollTop ?? 0;
    setPreviewTurn(
      itemAtPointer(items, event.currentTarget, scrollTop, event.clientY)
        ?.turn ?? null,
    );
  };
  const navigateAtPointer = (event: MouseEvent<HTMLElement>): void => {
    const scrollTop = ladderRef.current?.scrollTop ?? 0;
    const item = itemAtPointer(
      items,
      event.currentTarget,
      scrollTop,
      event.clientY,
    );
    if (item !== undefined) onNavigate(item);
  };
  const ladderClasses = ["dsh-qa-rail__scroll"];
  if (scrollState.canScrollUp)
    ladderClasses.push("dsh-qa-rail__scroll--fade-top");
  if (scrollState.canScrollDown) {
    ladderClasses.push("dsh-qa-rail__scroll--fade-bottom");
  }
  return (
    <div ref={slotRef} className="dsh-qa-rail">
      <nav
        className="dsh-qa-rail__frame"
        style={
          {
            "--dsh-qa-rail-natural": `${
              (items.length - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX
            }px`,
            "--dsh-qa-rail-scroll-top": `${scrollState.top}px`,
          } as CSSProperties
        }
        aria-label="Переход по вопросам"
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerEnter={() => {
          pointerInsideRef.current = true;
        }}
        onPointerLeave={() => {
          pointerInsideRef.current = false;
          setPreviewTurn(null);
        }}
      >
        <div
          ref={ladderRef}
          className={ladderClasses.join(" ")}
          onScroll={() => {
            syncScrollState();
          }}
        >
          <div className="dsh-qa-rail__marks">
            {items.map((item, index) => {
              const active = item.turn === activeTurn;
              const showingPreview = item.turn === previewTurn;
              const classes = ["dsh-qa-rail__mark"];
              if (active) classes.push("dsh-qa-rail__mark--active");
              else if (showingPreview) {
                classes.push("dsh-qa-rail__mark--preview");
              }
              if (item.turn === busyTurn)
                classes.push("dsh-qa-rail__mark--busy");
              return (
                <div
                  key={item.turn}
                  className="dsh-qa-rail__pos"
                  style={
                    {
                      "--dsh-qa-rail-pos": `${index * TURN_SPACING_PX}px`,
                    } as CSSProperties
                  }
                >
                  <button
                    type="button"
                    className={classes.join(" ")}
                    aria-label={`К вопросу ${item.turn}`}
                    aria-current={active ? "true" : undefined}
                    aria-busy={item.turn === busyTurn ? "true" : undefined}
                    aria-describedby={showingPreview ? previewId : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      onNavigate(item);
                    }}
                    onFocus={() => {
                      setPreviewTurn(item.turn);
                    }}
                    onBlur={() => {
                      setPreviewTurn(null);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {preview !== undefined && previewPosition !== undefined ? (
          <div
            id={previewId}
            role="tooltip"
            className="dsh-qa-rail__preview"
            style={
              {
                "--dsh-qa-rail-pos": `${previewPosition}px`,
              } as CSSProperties
            }
          >
            <div className="dsh-qa-rail__preview-prompt">{preview.prompt}</div>
            {preview.response === "" ? null : (
              <div className="dsh-qa-rail__preview-response">
                {preview.response}
              </div>
            )}
          </div>
        ) : null}
      </nav>
    </div>
  );
}

function sameRailProps(
  previous: QaTurnRailProps,
  next: QaTurnRailProps,
): boolean {
  return (
    previous.activeTurn === next.activeTurn &&
    previous.busyTurn === next.busyTurn &&
    previous.scrollerRef === next.scrollerRef &&
    previous.onNavigate === next.onNavigate &&
    sameTurnRailItems(previous.items, next.items)
  );
}

/**
 * Fixed-pitch rail of every turn of the visible transcript, floating over the
 * transcript's right gutter: the active mark follows the reading line, a
 * hover/focus preview shows the prompt and answer, and a click lands the
 * transcript on that turn. Memoized like the harness rail — the transcript
 * re-renders on every streaming delta, and the rail only changes when a turn
 * is added or becomes active.
 */
export const QaTurnRail = memo(QaTurnRailView, sameRailProps);

/** Land the transcript on a turn's prompt row, harness-style. */
export function turnScrollTarget(
  scroller: HTMLElement,
  row: HTMLElement,
): number {
  const top =
    scroller.scrollTop +
    row.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return Math.min(max, Math.max(0, top - QA_TURN_LAND_PX));
}
