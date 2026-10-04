// @vitest-environment jsdom

/**
 * Д2 of the 2026-10-04 stand round: at 390px the phone layout switched the whole
 * chat-history sidebar off, and the only control that opened it stood inside the
 * subtree that was switched off. A phone reader had no history, no search and no
 * «Новый чат», and nothing in the header answered for them.
 *
 * jsdom applies no media query, so rendering the components alone proves nothing
 * about a width. What the layout decides is read off the shipped sheet instead:
 * the rules are collected out of `styles.ts`, the ones a 390x844 viewport answers
 * are kept, and the cascade is resolved per element. The question the suite asks
 * of a real rendered control is then the one a phone asks it — is this on the
 * screen, and is it big enough to press.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import { QA_SURFACE_STYLES } from "../../../src/client/styles.js";
import {
  buildChatRows,
  QaSidebar,
  type QaSidebarProps,
} from "../../../src/client/components/QaSidebar.js";
import {
  QaHeader,
  type QaHeaderProps,
} from "../../../src/client/components/QaHeader.js";

afterEach(cleanup);

const PHONE = { width: 390, height: 844 } as const;
const STATE_KEY = "dsh-qa-surface.session:v1:/qa";

/**
 * One declaration block of the sheet, with the media condition that carries it.
 *
 * The cascade is emulated, not approximated away: the phone block hides the
 * sidebar and the same block has to bring it back, so which of the two wins is
 * the whole question, and it is decided by `!important`, then by specificity,
 * then by source order — the three things a browser reads.
 */
interface SheetRule {
  readonly condition: string | null;
  readonly selector: string;
  readonly body: string;
  readonly order: number;
}

interface Candidate {
  readonly value: string;
  readonly important: boolean;
  readonly weight: number;
  readonly order: number;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, "");
}

/** Index of the `}` closing the `{` at `open`. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length;
}

/** `@media (a) and (b)` — the condition text, without the at-rule keyword. */
function mediaCondition(prelude: string): string {
  return prelude.slice("@media".length).trim();
}

function collectRules(
  source: string,
  condition: string | null,
  out: SheetRule[],
): void {
  let prelude = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === "{") {
      const end = matchingBrace(source, index);
      const selector = prelude.trim();
      prelude = "";
      if (selector.startsWith("@media")) {
        collectRules(
          source.slice(index + 1, end),
          mediaCondition(selector),
          out,
        );
      } else if (!selector.startsWith("@")) {
        out.push({
          condition,
          selector,
          body: source.slice(index + 1, end).trim(),
          order: out.length,
        });
      }
      index = end + 1;
      continue;
    }
    // A statement (`@import`, `@charset`) or a stray brace ends the prelude.
    if (char === "}" || char === ";") {
      prelude = "";
      index += 1;
      continue;
    }
    prelude += char;
    index += 1;
  }
}

/**
 * Whether a media condition holds on the phone the round measured.
 *
 * A condition this file cannot read is treated as one that does not apply: the
 * sheet's remaining queries key on hover, motion, landscape height and color
 * preferences, none of which a 390x844 portrait page answers, and guessing wrong
 * about one of them would let the suite invent a rule the browser never applies.
 */
function appliesToPhone(condition: string | null): boolean {
  if (condition === null) return true;
  if (
    /orientation|max-height|min-height|prefers-|hover|pointer|contrast/u.test(
      condition,
    )
  )
    return false;
  const maxWidth = /max-width:\s*(\d+(?:\.\d+)?)px/u.exec(condition);
  const minWidth = /min-width:\s*(\d+(?:\.\d+)?)px/u.exec(condition);
  if (minWidth !== null) return Number(minWidth[1]) <= PHONE.width;
  if (maxWidth !== null) return Number(maxWidth[1]) >= PHONE.width;
  return false;
}

/** `a, b > c` — the selector list, split outside any bracket. */
function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selector) {
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

/**
 * Class-level specificity: an id, a class or an attribute is one step, a type
 * selector is not. Exact for the sheet this file reads, which names its elements
 * by class alone.
 */
function weightOf(selector: string): number {
  return (selector.match(/[.#[]/gu) ?? []).length;
}

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    // A selector this DOM cannot evaluate (a `:has()` subtree, a pseudo-class)
    // is one the suite does not reason about.
    return false;
  }
}

function beats(candidate: Candidate, current: Candidate | null): boolean {
  if (current === null) return true;
  if (candidate.important !== current.important) return candidate.important;
  if (candidate.weight !== current.weight)
    return candidate.weight > current.weight;
  return candidate.order > current.order;
}

const SHEET_RULES: SheetRule[] = [];
collectRules(stripComments(QA_SURFACE_STYLES), null, SHEET_RULES);

/** The value this element's own winning rule declares for `property`. */
function declared(element: Element, property: string): string | null {
  let best: Candidate | null = null;
  let value: string | null = null;
  for (const rule of SHEET_RULES) {
    if (!appliesToPhone(rule.condition)) continue;
    const declaration = new RegExp(
      `(?:^|;)\\s*${property}:\\s*([^;]+)`,
      "u",
    ).exec(rule.body);
    if (declaration === null) continue;
    const raw = (declaration[1] ?? "").trim();
    const important = /!important$/u.test(raw);
    const declaredValue = raw.replace(/\s*!important$/u, "");
    for (const selector of splitSelectors(rule.selector)) {
      if (!matches(element, selector)) continue;
      const candidate: Candidate = {
        value: declaredValue,
        important,
        weight: weightOf(selector),
        order: rule.order,
      };
      if (beats(candidate, best)) {
        best = candidate;
        value = declaredValue;
      }
    }
  }
  return value;
}

/**
 * Whether the phone layout leaves this element on the screen: a control under an
 * ancestor the sheet switched off is not reachable, however it is styled itself.
 */
function onScreen(element: Element): boolean {
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    if (declared(node, "display") === "none") return false;
  }
  return true;
}

function pixels(value: string | null): number {
  const match = /^(\d+(?:\.\d+)?)px$/u.exec(value ?? "");
  return match === null ? 0 : Number(match[1]);
}

/** The smallest press target the sheet gives this control at the phone width. */
function pressTarget(element: Element): { width: number; height: number } {
  return {
    width: Math.max(
      pixels(declared(element, "width")),
      pixels(declared(element, "min-width")),
    ),
    height: Math.max(
      pixels(declared(element, "height")),
      pixels(declared(element, "min-height")),
    ),
  };
}

const byId = {
  "s-1": {
    id: "s-1",
    displayTitle: "Сколько будет 2+2?",
    running: false,
    blank: false,
    updatedAt: 1_000,
  },
} as unknown as Record<string, SessionSummary>;

const rows = buildChatRows(["s-1"], byId, null, undefined, 90_000);

/** The surface's own tree: the sidebar and the body are siblings under `<main>`. */
function renderPhone(props: {
  readonly drawerOpen: boolean;
  readonly onDrawerClose: () => void;
  readonly sidebar?: Partial<QaSidebarProps>;
  readonly history?: QaHeaderProps["history"];
}): {
  newChat: HTMLElement;
  chatRow: HTMLElement;
  nav: HTMLElement;
} {
  render(
    <main className="dsh-qa-surface" data-testid="qa-surface-root">
      <QaSidebar
        rows={rows}
        title="Демо-продукт"
        logoUrl={null}
        stateKey={STATE_KEY}
        showNewChat
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
        drawerOpen={props.drawerOpen}
        onDrawerClose={props.onDrawerClose}
        {...props.sidebar}
      />
      <div className="dsh-qa-body">
        <QaHeader
          logoUrl={null}
          title="Сколько будет 2+2?"
          viewingSubagent={false}
          onCloseSubagent={() => undefined}
          agentCount={0}
          agentsOpen={false}
          onToggleAgents={() => undefined}
          sourcesVisible
          sourcesCount={0}
          sourcesComplete
          sourcesOpen={false}
          onOpenSources={() => undefined}
          fileCount={0}
          filesEnabled
          filesOpen={false}
          onOpenFiles={() => undefined}
          showReset={false}
          resetDisabled={false}
          onReset={() => undefined}
          {...(props.history === undefined ? {} : { history: props.history })}
        />
      </div>
    </main>,
  );
  const nav = screen.getByTestId("qa-surface-sidebar");
  return {
    nav,
    newChat: screen.getByTestId("qa-surface-sidebar-new"),
    chatRow: screen.getByTestId("qa-surface-sidebar-item-open"),
  };
}

describe("chat history at the phone width", () => {
  // The rule the round tripped over: an unconditional switch of the whole
  // sidebar subtree off, with nothing outside it left to answer for the history.
  it("never leaves the phone layout without an opener outside the sidebar", () => {
    const opener = render(
      <main className="dsh-qa-surface">
        <div className="dsh-qa-body">
          <QaHeader
            logoUrl={null}
            title="Сколько будет 2+2?"
            viewingSubagent={false}
            onCloseSubagent={() => undefined}
            agentCount={0}
            agentsOpen={false}
            onToggleAgents={() => undefined}
            sourcesVisible
            sourcesCount={0}
            sourcesComplete
            sourcesOpen={false}
            onOpenSources={() => undefined}
            fileCount={0}
            filesEnabled
            filesOpen={false}
            onOpenFiles={() => undefined}
            showReset={false}
            resetDisabled={false}
            onReset={() => undefined}
            history={{ open: false, onToggle: () => undefined }}
          />
        </div>
      </main>,
    ).container.querySelector<HTMLElement>(
      "[data-testid='qa-surface-header-history']",
    );
    expect(opener, "no control opens the chat history").not.toBeNull();

    // A control inside the subtree the width switches off is no control at all:
    // that is exactly what the round found.
    expect(opener?.closest("nav")).toBeNull();
    expect(onScreen(opener!)).toBe(true);
    expect(pressTarget(opener!).height).toBeGreaterThanOrEqual(44);
    expect(pressTarget(opener!).width).toBeGreaterThanOrEqual(44);
  });

  it("names the opener for the reader who cannot see the icon", () => {
    render(
      <QaHeader
        logoUrl={null}
        title="Сколько будет 2+2?"
        viewingSubagent={false}
        onCloseSubagent={() => undefined}
        agentCount={0}
        agentsOpen={false}
        onToggleAgents={() => undefined}
        sourcesVisible
        sourcesCount={0}
        sourcesComplete
        sourcesOpen={false}
        onOpenSources={() => undefined}
        fileCount={0}
        filesEnabled
        filesOpen={false}
        onOpenFiles={() => undefined}
        showReset={false}
        resetDisabled={false}
        onReset={() => undefined}
        history={{ open: true, onToggle: () => undefined }}
      />,
    );
    const opener = screen.getByRole("button", { name: "История чатов" });
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(opener.querySelector("svg")).not.toBeNull();
  });

  it("shows the history, the search and «Новый чат» once the drawer is open", () => {
    const { newChat, chatRow, nav } = renderPhone({
      drawerOpen: true,
      onDrawerClose: () => undefined,
      history: { open: true, onToggle: () => undefined },
    });
    expect(onScreen(nav)).toBe(true);
    expect(onScreen(newChat)).toBe(true);
    expect(onScreen(chatRow)).toBe(true);
    expect(
      onScreen(screen.getByTestId("qa-surface-sidebar-search-input")),
    ).toBe(true);
    // The drawer is sized against the viewport, never by the fixed rail width the
    // wide layout uses, so it cannot hang off the right edge of this screen.
    const width = declared(nav, "width") ?? "";
    const vw = /(\d+(?:\.\d+)?)vw/u.exec(width);
    const px = /(\d+(?:\.\d+)?)px/u.exec(width);
    expect(vw, `${width} is not sized against the viewport`).not.toBeNull();
    expect(px, `${width} carries no ceiling`).not.toBeNull();
    expect(
      Math.min(
        Number(px?.[1] ?? 0),
        (Number(vw?.[1] ?? 0) / 100) * PHONE.width,
      ),
    ).toBeLessThan(PHONE.width);
  });

  it("keeps a closed drawer off the layout, and off the Tab ring with it", () => {
    const { nav, newChat } = renderPhone({
      drawerOpen: false,
      onDrawerClose: () => undefined,
      history: { open: false, onToggle: () => undefined },
    });
    // `display:none` rather than an off-screen transform: the ring reads the
    // sheet through `display` alone, and a phantom step is a stuck Tab key.
    expect(declared(nav, "display")).toBe("none");
    expect(onScreen(nav)).toBe(false);
    expect(onScreen(newChat)).toBe(false);
  });

  it("opens the drawer over a sidebar the desktop left collapsed", () => {
    window.localStorage.setItem(`${STATE_KEY}:sidebar-collapsed`, "1");
    try {
      const { nav, chatRow } = renderPhone({
        drawerOpen: true,
        onDrawerClose: () => undefined,
        history: { open: true, onToggle: () => undefined },
      });
      // The rail is a wide-layout affordance; a phone that asked for its history
      // gets the history, not a 52px strip the sheet then hides anyway.
      expect(nav.dataset["qaDrawer"]).toBe("open");
      expect(onScreen(chatRow)).toBe(true);
    } finally {
      window.localStorage.removeItem(`${STATE_KEY}:sidebar-collapsed`);
    }
  });

  it("closes the drawer without touching the desktop rail state", () => {
    window.localStorage.clear();
    const onDrawerClose = vi.fn();
    const { nav } = renderPhone({
      drawerOpen: true,
      onDrawerClose,
      history: { open: true, onToggle: () => undefined },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Закрыть историю чатов" }),
    );
    expect(onDrawerClose).toHaveBeenCalledTimes(1);
    expect(
      window.localStorage.getItem(`${STATE_KEY}:sidebar-collapsed`),
    ).toBeNull();

    // The drawer stands over the header, so the opener that would otherwise be
    // the way back is behind it; the key answers in its place.
    fireEvent.keyDown(nav, { key: "Escape" });
    expect(onDrawerClose).toHaveBeenCalledTimes(2);
  });

  it("hands the screen back after opening a chat or starting a new one", () => {
    const onDrawerClose = vi.fn();
    const onSwitch = vi.fn();
    const onNewChat = vi.fn();
    renderPhone({
      drawerOpen: true,
      onDrawerClose,
      sidebar: { onSwitch, onNewChat },
      history: { open: true, onToggle: () => undefined },
    });
    fireEvent.click(screen.getByTestId("qa-surface-sidebar-item-open"));
    expect(onSwitch).toHaveBeenCalledWith("s-1");
    expect(onDrawerClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("qa-surface-sidebar-new"));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(onDrawerClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the wide layout's rail collapse exactly where it was", () => {
    window.localStorage.clear();
    const onDrawerClose = vi.fn();
    renderPhone({
      drawerOpen: false,
      onDrawerClose,
      history: { open: false, onToggle: () => undefined },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Свернуть историю чатов" }),
    );
    expect(screen.getByTestId("qa-surface-sidebar-collapsed")).toBeTruthy();
    expect(window.localStorage.getItem(`${STATE_KEY}:sidebar-collapsed`)).toBe(
      "1",
    );
    expect(onDrawerClose).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть историю чатов" }),
    );
    expect(screen.queryByTestId("qa-surface-sidebar-collapsed")).toBeNull();
    window.localStorage.clear();
  });

  it("gives the drawer's own controls a target a thumb presses", () => {
    const { newChat, chatRow } = renderPhone({
      drawerOpen: true,
      onDrawerClose: () => undefined,
      history: { open: true, onToggle: () => undefined },
    });
    expect(pressTarget(newChat).height).toBeGreaterThanOrEqual(44);
    expect(pressTarget(chatRow).height).toBeGreaterThanOrEqual(44);
    const close = screen.getByRole("button", { name: "Закрыть историю чатов" });
    expect(pressTarget(close).height).toBeGreaterThanOrEqual(44);
  });
});
