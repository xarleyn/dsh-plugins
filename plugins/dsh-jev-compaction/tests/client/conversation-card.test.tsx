// @vitest-environment jsdom

/**
 * The conversation half of SPEC §28: the Definition that turns one recorded
 * event into one card, and the card itself. Collapsed by default, expanded on
 * demand, metadata only.
 */

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  JEV_COMPACTION_NODE_KIND,
  jevCompactionConversationDefinition,
  type JevCompactionChatData,
} from "../../src/client/conversation.js";
import { JevCompactionRunCard } from "../../src/client/run-card.js";
import type { JevCompactionAppliedEventData } from "../../src/shared/session-events.js";

afterEach(cleanup);

const RUN: JevCompactionAppliedEventData = Object.freeze({
  mode: "auto",
  trigger: "context-ratio",
  stage: "abridged",
  candidates: 4,
  mutations: 2,
  applied: 2,
  batches: 1,
  maxConcurrency: 4,
  charsSaved: 7364,
  tokensBefore: 1000,
  tokensAfter: 264,
  contextWindow: 1400,
  actions: { KEEP_FULL: 2, KEEP_TRUNCATED: 0, KEEP_STUB: 2 },
  items: Object.freeze([
    Object.freeze({
      tool: "read",
      chars: 3682,
      action: "KEEP_STUB" as const,
      needContents: 0.05,
      originalSeq: 7,
      replacementSeq: 31,
    }),
    Object.freeze({
      tool: "grep",
      chars: 3682,
      action: "KEEP_STUB" as const,
      needContents: 0.11,
      needVerbatim: 0.5,
      originalSeq: 11,
      replacementSeq: 32,
    }),
    Object.freeze({
      tool: "read",
      chars: 3682,
      action: "KEEP_FULL" as const,
      needContents: 0.92,
      originalSeq: 15,
      replacementSeq: null,
    }),
  ]),
});

function runData(
  overrides: Partial<JevCompactionChatData> = {},
): JevCompactionChatData {
  return {
    view: "run",
    seq: 42,
    time: Date.UTC(2026, 9, 11, 11, 14, 43),
    run: RUN,
    ...overrides,
  } as JevCompactionChatData;
}

function renderCard(data: JevCompactionChatData): HTMLElement {
  const node = {
    key: `jev-compaction:${data.seq}`,
    kind: JEV_COMPACTION_NODE_KIND,
    id: String(data.seq),
    target: "chat",
    anchorSeq: data.seq,
    location: { kind: "session" },
    visibility: "visible",
    data,
  };
  const props = { node } as unknown as ComponentProps<
    typeof JevCompactionRunCard
  >;
  const { container } = render(<JevCompactionRunCard {...props} />);
  return container;
}

function ownEvent(seq: number, time: number): SessionEvent {
  return {
    type: "jev-compaction/applied",
    seq,
    time,
    data: RUN,
  } as unknown as SessionEvent;
}

describe("conversation Definition", () => {
  const definition = jevCompactionConversationDefinition;

  it("claims only its own events", () => {
    const foreign = {
      type: "compaction/summary",
      seq: 3,
      time: 0,
      data: {},
    } as unknown as SessionEvent;
    expect(definition.match(foreign)).toBeNull();
    expect(definition.match(ownEvent(9, 0))).toEqual({
      id: "9",
      role: "start",
    });
  });

  it("gives every event its own context, so runs never merge", () => {
    expect(definition.match(ownEvent(9, 0))!.id).not.toBe(
      definition.match(ownEvent(12, 1))!.id,
    );
  });

  it("builds one Chat node per recorded event, keyed by its seq", () => {
    const event = ownEvent(21, 5);
    const startMatch = {
      event,
      role: "start" as const,
      location: { kind: "session" as const },
    };
    const state = definition.start!(
      { matches: [startMatch], start: startMatch } as never,
      startMatch,
      { previous: () => undefined },
    );
    const node = definition.buildViewNode!({
      key: "jev-compaction:21",
      kind: JEV_COMPACTION_NODE_KIND,
      id: "21",
      matches: [startMatch],
      start: startMatch,
      state,
      current: new Map(),
    } as never);
    expect(node).toMatchObject({
      key: "jev-compaction:21",
      kind: "jev-compaction",
      target: "chat",
      anchorSeq: 21,
      visibility: "visible",
      data: { view: "run", seq: 21, run: RUN },
    });
  });
});

describe("run card", () => {
  it("collapses by default and answers the headline question", () => {
    const container = renderCard(runData());
    const header = screen.getByRole("button", {
      name: "Show the Jev compaction report",
    });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("Jev compaction");
    expect(container.textContent).toContain("2 results replaced");
    expect(container.textContent).toContain("1 000 \u2192 264 tokens");
    expect(container.textContent).toContain("736 saved (74%)");
    // The detail is not in the DOM until it is asked for.
    expect(container.querySelector(".jevc-run-items")).toBeNull();
    expect(container.textContent).not.toContain("Candidates");
  });

  it("expands into the full report with addressable seq pairs", () => {
    const container = renderCard(runData());
    fireEvent.click(
      screen.getByRole("button", { name: "Show the Jev compaction report" }),
    );
    const header = screen.getByRole("button", {
      name: "Hide the Jev compaction report",
    });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Candidates");
    expect(container.textContent).toContain("Jev requests");
    expect(container.textContent).toContain("context ratio");
    expect(container.textContent).toContain("abridged");
    expect(container.textContent).toContain("KEEP_STUB");
    const rows = container.querySelectorAll(".jevc-run-items tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("7 \u2192 31");
    expect(rows[0]!.textContent).toContain("0.05");
    expect(rows[2]!.textContent).toContain("15 \u2192 kept");
    // The provenance line is part of the contract, not decoration.
    expect(container.textContent).toContain("Metadata only");
  });

  it("marks a dry-run as a preview that kept every result", () => {
    const dry = runData({
      run: {
        ...RUN,
        mode: "dry-run",
        applied: 0,
        items: RUN.items.map((item) => ({ ...item, replacementSeq: null })),
      },
    });
    const container = renderCard(dry);
    expect(container.textContent).toContain("dry-run");
    expect(container.textContent).toContain("2 results would be replaced");
    fireEvent.click(
      screen.getByRole("button", { name: "Show the Jev compaction report" }),
    );
    expect(container.textContent).toContain("7 \u2192 kept");
  });

  it("renders a skip as one line with its reason and no expander", () => {
    const container = renderCard({
      view: "skip",
      seq: 8,
      time: Date.UTC(2026, 9, 11, 11, 24, 18),
      skip: {
        mode: "auto",
        reason: "cooldown",
        candidates: 4,
        tokensBefore: 172_322,
      },
    });
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("skipped");
    expect(container.textContent).toContain("cooldown");
    expect(container.textContent).toContain("4 candidates seen");
    expect(container.textContent).toContain("172 322 surface tokens");
  });
});
