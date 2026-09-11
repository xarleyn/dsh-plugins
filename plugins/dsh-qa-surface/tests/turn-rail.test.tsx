// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QA_TURN_ANCHOR_ATTRIBUTE,
  QaTurnRail,
  buildTurnRailItems,
  computeActiveTurn,
  sameTurnRailItems,
  turnScrollTarget,
  type QaTurnRailItem,
  type QaTurnRailProps,
} from "../src/client/components/QaTurnRail.js";
import type { QaMessage } from "../src/types.js";

function user(text: string, id: string): QaMessage {
  return { id, role: "user", text, status: "committed" };
}

function assistant(text: string, turn: number): QaMessage {
  return { id: `a${turn}`, role: "assistant", text, status: "committed", turn };
}

describe("QA turn rail items", () => {
  it("opens one mark per user prompt and previews the first answer", () => {
    const items = buildTurnRailItems([
      user("Первый вопрос", "u1"),
      { id: "w1", role: "work", turn: 1, status: "complete", items: [] },
      assistant("Первый ответ", 1),
      user("Второй  вопрос", "u2"),
      assistant("", 2),
      assistant("Второй ответ", 3),
      { id: "s1", role: "system", text: "субагент завершён", status: "info" },
    ]);
    expect(items).toEqual([
      {
        turn: 1,
        id: "u1",
        prompt: "Первый вопрос",
        response: "Первый ответ",
      },
      {
        turn: 2,
        id: "u2",
        prompt: "Второй вопрос",
        response: "Второй ответ",
      },
    ]);
  });

  it("clips long prompt and response previews", () => {
    const items = buildTurnRailItems([
      user("Длинный ".repeat(40), "u1"),
      assistant("Ответ ".repeat(60), 1),
    ]);
    const first = items[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.prompt.length).toBeLessThanOrEqual(140);
    expect(first.prompt.endsWith("…")).toBe(true);
    expect(first.response.length).toBeLessThanOrEqual(220);
  });

  it("compares rail items structurally", () => {
    const items = buildTurnRailItems([
      user("q", "u1"),
      assistant("a", 1),
      user("q2", "u2"),
      assistant("a2", 2),
    ]);
    expect(sameTurnRailItems(items, items)).toBe(true);
    expect(sameTurnRailItems(items, [...items])).toBe(true);
    const renamed = items.map((item, index) =>
      index === 0 ? { ...item, id: "u9" } : item,
    );
    expect(sameTurnRailItems(items, renamed)).toBe(false);
    expect(sameTurnRailItems(items, items.slice(0, 1))).toBe(false);
  });
});

interface ScrollerGeometry {
  readonly top: number;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

function railFixture(
  anchorTops: readonly number[],
  geometry: ScrollerGeometry,
): { scroller: HTMLDivElement; items: readonly QaTurnRailItem[] } {
  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "scrollHeight", {
    value: geometry.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, "clientHeight", {
    value: geometry.clientHeight,
    configurable: true,
  });
  Object.defineProperty(scroller, "scrollTop", {
    value: geometry.scrollTop,
    configurable: true,
    writable: true,
  });
  scroller.getBoundingClientRect = () => ({ top: geometry.top }) as DOMRect;
  const items: QaTurnRailItem[] = anchorTops.map((_, index) => ({
    turn: index + 1,
    id: `u${index + 1}`,
    prompt: `Вопрос ${index + 1}`,
    response: "",
  }));
  anchorTops.forEach((top, index) => {
    const row = document.createElement("div");
    row.setAttribute(QA_TURN_ANCHOR_ATTRIBUTE, `u${index + 1}`);
    row.getBoundingClientRect = () => ({ top }) as DOMRect;
    scroller.appendChild(row);
  });
  return { scroller, items };
}

describe("QA turn rail tracking", () => {
  it("pins the mark to the newest turn while following the tail", () => {
    const { scroller, items } = railFixture([10, 400, 900], {
      top: 0,
      scrollTop: 410,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    expect(computeActiveTurn(scroller, items)).toBe(3);
  });

  it("follows the reading line while scrolling history", () => {
    const { scroller, items } = railFixture([10, 400, 900], {
      top: 0,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    // Reading line at 96px: only the first anchor is above it.
    expect(computeActiveTurn(scroller, items)).toBe(1);
    const moved = railFixture([10, 90, 400], {
      top: 0,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    expect(computeActiveTurn(moved.scroller, moved.items)).toBe(2);
  });

  it("keeps the first turn when no anchor reaches the reading line", () => {
    const { scroller, items } = railFixture([400, 900], {
      top: 0,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    expect(computeActiveTurn(scroller, items)).toBe(1);
  });

  it("has no turn without marks", () => {
    const { scroller, items } = railFixture([], {
      top: 0,
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 500,
    });
    expect(computeActiveTurn(scroller, items)).toBeNull();
  });

  it("lands a turn's prompt 24px under the scrollport top, clamped", () => {
    const { scroller } = railFixture([10], {
      top: 0,
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    const row = scroller.querySelector<HTMLElement>(
      `[${QA_TURN_ANCHOR_ATTRIBUTE}]`,
    );
    expect(row).not.toBeNull();
    if (row === null) return;
    row.getBoundingClientRect = () => ({ top: 220 }) as DOMRect;
    // 100 + 220 - 24
    expect(turnScrollTarget(scroller, row)).toBe(296);
    row.getBoundingClientRect = () => ({ top: 5 }) as DOMRect;
    expect(turnScrollTarget(scroller, row)).toBe(81);
    scroller.scrollTop = 0;
    row.getBoundingClientRect = () => ({ top: 10 }) as DOMRect;
    expect(turnScrollTarget(scroller, row)).toBe(0);
    row.getBoundingClientRect = () => ({ top: 2500 }) as DOMRect;
    expect(turnScrollTarget(scroller, row)).toBe(1500);
  });
});

const RAIL_ITEMS: readonly QaTurnRailItem[] = [
  { turn: 1, id: "u1", prompt: "Первый", response: "Ответ 1" },
  { turn: 2, id: "u2", prompt: "Второй", response: "" },
  { turn: 3, id: "u3", prompt: "Третий", response: "Ответ 3" },
];

/** jsdom has no PointerEvent, so pointer coordinates ride a plain Event. */
function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientY: { value: clientY } });
  return event;
}

/** React derives onPointerLeave from a bubbling pointerout. */
function pointerOutEvent(): Event {
  const event = new Event("pointerout", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    relatedTarget: { value: document.body },
  });
  return event;
}

function renderRail(
  overrides: Partial<QaTurnRailProps> = {},
): ReturnType<typeof render> {
  return render(
    <QaTurnRail
      items={RAIL_ITEMS}
      activeTurn={2}
      busyTurn={null}
      scrollerRef={{ current: null }}
      onNavigate={vi.fn()}
      {...overrides}
    />,
  );
}

describe("QA turn rail component", () => {
  it("renders nothing for a single turn", () => {
    const { container } = renderRail({
      items: [{ turn: 1, id: "u1", prompt: "Первый", response: "" }],
    });
    expect(container.querySelector(".dsh-qa-rail")).toBeNull();
  });

  it("renders the fixed-pitch ladder with active and busy marks", () => {
    renderRail({ busyTurn: 3 });
    const nav = screen.getByRole("navigation", {
      name: "Переход по вопросам",
    });
    expect(nav).not.toBeNull();
    const marks = screen.getAllByRole("button");
    expect(marks).toHaveLength(3);
    expect(marks[0]?.getAttribute("aria-label")).toBe("К вопросу 1");
    expect(marks[1]?.getAttribute("aria-current")).toBe("true");
    expect(marks[2]?.getAttribute("aria-busy")).toBe("true");
    expect(marks[0]?.getAttribute("aria-current")).toBeNull();
  });

  it("navigates from the frame column and from a mark", () => {
    const onNavigate = vi.fn();
    renderRail({ onNavigate });
    fireEvent.click(screen.getByRole("button", { name: "К вопросу 1" }));
    expect(onNavigate).toHaveBeenCalledWith(RAIL_ITEMS[0]);
    const nav = screen.getByRole("navigation", {
      name: "Переход по вопросам",
    });
    fireEvent.click(nav, { clientY: 300 });
    expect(onNavigate).toHaveBeenCalledWith(RAIL_ITEMS[2]);
  });

  it("previews the hovered turn and clears it on leave", () => {
    renderRail();
    const nav = screen.getByRole("navigation", {
      name: "Переход по вопросам",
    });
    fireEvent(nav, pointerEvent("pointermove", 10));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Первый");
    expect(tooltip.textContent).toContain("Ответ 1");
    fireEvent(nav, pointerOutEvent());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
