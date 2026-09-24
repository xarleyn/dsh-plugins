import { describe, expect, it } from "vitest";
import {
  settleTurnCompletions,
  type QaChatActivity,
} from "../src/client/notifications/turn-completion-source.js";

function chat(
  id: string,
  running: boolean,
  title = `Чат ${id}`,
): QaChatActivity {
  return { id, title, running };
}

/**
 * The notices a page may raise are bounded by what this function is fed, so
 * the rules of who is reported — and who is silently skipped — live here.
 */
describe("turn completion source", () => {
  it("reports a chat once it stops, and not before", () => {
    const seen = new Map<string, boolean>();
    expect(
      settleTurnCompletions(seen, [chat("a", true)], { now: 1_000 }),
    ).toEqual([]);
    expect(
      settleTurnCompletions(seen, [chat("a", true)], { now: 1_500 }),
    ).toEqual([]);
    expect(
      settleTurnCompletions(seen, [chat("a", false)], { now: 2_000 }),
    ).toEqual([{ sessionId: "a", title: "Чат a", at: 2_000 }]);
    expect(
      settleTurnCompletions(seen, [chat("a", false)], { now: 3_000 }),
    ).toEqual([]);
  });

  it("keeps the cold-start projection silent", () => {
    const seen = new Map<string, boolean>();
    // A chat that was already running when the page opened is not a turn this
    // reader started, and the first frame must not read as a batch of
    // completions.
    const completions = settleTurnCompletions(
      seen,
      [chat("a", true), chat("b", false), chat("c", true)],
      { now: 1_000 },
    );
    expect(completions).toEqual([]);
    expect([...seen.entries()]).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
  });

  it("never reports a chat it did not see running", () => {
    const seen = new Map<string, boolean>();
    settleTurnCompletions(seen, [chat("a", false)], { now: 1 });
    expect(settleTurnCompletions(seen, [chat("a", false)], { now: 2 })).toEqual(
      [],
    );
  });

  it("reports every chat that settles in one frame", () => {
    const seen = new Map<string, boolean>([
      ["a", true],
      ["b", true],
      ["c", false],
    ]);
    expect(
      settleTurnCompletions(
        seen,
        [chat("a", false), chat("b", false), chat("c", false)],
        { now: 42 },
      ).map((completion) => completion.sessionId),
    ).toEqual(["a", "b"]);
  });

  it("drops a chat that leaves the list and rebuilds its baseline", () => {
    const seen = new Map<string, boolean>();
    settleTurnCompletions(seen, [chat("a", true)], { now: 1 });
    // Deleted here, or simply no longer listed by the host.
    expect(settleTurnCompletions(seen, [], { now: 2 })).toEqual([]);
    expect(seen.size).toBe(0);
    // Re-added idle, then run: only the turn it watched is reported.
    settleTurnCompletions(seen, [chat("a", false)], { now: 3 });
    settleTurnCompletions(seen, [chat("a", true)], { now: 4 });
    expect(
      settleTurnCompletions(seen, [chat("a", false)], { now: 5 }),
    ).toHaveLength(1);
  });

  it("re-projects silently while the browser is reconnecting", () => {
    const seen = new Map<string, boolean>();
    settleTurnCompletions(seen, [chat("a", true)], { now: 1 });
    // The link dropped: the frames that follow carry a list this page cannot
    // vouch for, so the turns they appear to have finished go unreported.
    expect(
      settleTurnCompletions(seen, [chat("a", false)], {
        now: 2,
        paused: true,
      }),
    ).toEqual([]);
    expect(settleTurnCompletions(seen, [chat("a", false)], { now: 3 })).toEqual(
      [],
    );
  });

  it("keeps its own clock for a completion without an explicit one", () => {
    const seen = new Map<string, boolean>([["a", true]]);
    const before = Date.now();
    const [completion] = settleTurnCompletions(seen, [chat("a", false)]);
    expect(completion?.at).toBeGreaterThanOrEqual(before);
  });
});
