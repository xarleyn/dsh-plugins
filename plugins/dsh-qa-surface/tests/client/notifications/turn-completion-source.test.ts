import { describe, expect, it } from "vitest";
import {
  settleTurnCompletions,
  type QaChatActivity,
  type QaTurnCompletion,
  type QaTurnSighting,
} from "../../../src/client/notifications/turn-completion-source.js";

function chat(
  id: string,
  running: boolean,
  title = `Чат ${id}`,
): QaChatActivity {
  return { id, title, running };
}

/**
 * One page's side of the host list: what it sees, in the order it sees it, and
 * what each frame was worth as a notice. The notices a page may raise are
 * bounded by what it watched, so who is reported — and who is silently skipped
 * — is decided here.
 */
function openPage() {
  const seen = new Map<string, QaTurnSighting>();
  const see = (
    chats: readonly QaChatActivity[],
    options: { paused?: boolean; now?: number } = {},
  ): QaTurnCompletion[] => settleTurnCompletions(seen, chats, options);
  /** One turn this page watched: idle, then running, then idle again. */
  const watchTurn = (id: string, now = 0): QaTurnCompletion[] => {
    see([chat(id, false)], { now });
    see([chat(id, true)], { now: now + 1 });
    return see([chat(id, false)], { now: now + 2 });
  };
  return { seen, see, watchTurn };
}

describe("turn completion source", () => {
  it("reports a chat once it stops, and not before", () => {
    const page = openPage();
    expect(page.see([chat("a", false)], { now: 1_000 })).toEqual([]);
    expect(page.see([chat("a", true)], { now: 1_500 })).toEqual([]);
    expect(page.see([chat("a", true)], { now: 1_800 })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 2_000 })).toEqual([
      { sessionId: "a", title: "Чат a", at: 2_000 },
    ]);
    expect(page.see([chat("a", false)], { now: 3_000 })).toEqual([]);
  });

  it("keeps the cold-start projection silent", () => {
    const page = openPage();
    // A chat that was already running when the page opened is not a turn this
    // reader started, and the first frame must not read as a batch of
    // completions.
    expect(
      page.see([chat("a", true), chat("b", false), chat("c", true)], {
        now: 1_000,
      }),
    ).toEqual([]);
    expect([...page.seen.entries()]).toEqual([
      ["a", "unwatched"],
      ["b", "idle"],
      ["c", "unwatched"],
    ]);
    // The silence is not deferred: the run found under way ends unreported, so
    // a turn that started before the page opened is never attributed to it.
    expect(
      page.see([chat("a", false), chat("b", false), chat("c", false)], {
        now: 2_000,
      }),
    ).toEqual([]);
  });

  it("reports the first turn a page watches begin after its cold start", () => {
    const page = openPage();
    // The page opens on a run already under way, and that run ends in silence.
    page.see([chat("a", true)], { now: 1 });
    page.see([chat("a", false)], { now: 2 });
    expect(page.seen.get("a")).toBe("idle");
    // The next turn is seen beginning: it is reported, once.
    expect(page.watchTurn("a", 3)).toEqual([
      { sessionId: "a", title: "Чат a", at: 5 },
    ]);
    expect(page.see([chat("a", false)], { now: 6 })).toEqual([]);
  });

  it("never reports a chat it did not see running", () => {
    const page = openPage();
    page.see([chat("a", false)], { now: 1 });
    expect(page.see([chat("a", false)], { now: 2 })).toEqual([]);
  });

  it("reports every chat that settles in one frame", () => {
    const page = openPage();
    page.see([chat("a", false), chat("b", false), chat("c", false)], {
      now: 1,
    });
    page.see([chat("a", true), chat("b", true), chat("c", false)], { now: 2 });
    expect(
      page
        .see([chat("a", false), chat("b", false), chat("c", false)], {
          now: 42,
        })
        .map((completion) => completion.sessionId),
    ).toEqual(["a", "b"]);
  });

  it("drops a chat that leaves the list and rebuilds its baseline", () => {
    const page = openPage();
    page.watchTurn("a", 1);
    // Deleted here, or simply no longer listed by the host.
    expect(page.see([], { now: 2 })).toEqual([]);
    expect(page.seen.size).toBe(0);
    // Re-added running: the run it shows is not the one this page watched, and
    // it ends unreported. Only a turn seen beginning from the rebuilt baseline
    // is reported.
    page.see([chat("a", true)], { now: 3 });
    expect(page.see([chat("a", false)], { now: 4 })).toEqual([]);
    expect(page.watchTurn("a", 5)).toHaveLength(1);
  });

  it("re-projects silently while the browser is reconnecting", () => {
    const page = openPage();
    page.see([chat("a", false)], { now: 1 });
    page.see([chat("a", true)], { now: 2 });
    // The link dropped: the frames that follow carry a list this page cannot
    // vouch for, so the turn they appear to have finished goes unreported.
    expect(page.see([chat("a", false)], { now: 3, paused: true })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 4 })).toEqual([]);
  });

  it("does not arm a baseline from an idle the gap left behind", () => {
    const page = openPage();
    page.see([chat("a", false)], { now: 1 });
    // The link returns before the host list does, which is the ordering the page
    // really gets: `paused` goes back off with the connection, while the rows
    // are still the ones the drop left. This frame says idle and proves nothing.
    expect(page.see([chat("a", false)], { now: 2, paused: true })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 3 })).toEqual([]);
    // The run this frame is followed by may have begun anywhere inside the gap,
    // so its end is not this reader's news — and it is not put off either: that
    // run is never reported.
    expect(page.see([chat("a", true)], { now: 4 })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 5 })).toEqual([]);
    // What the gap took was this page's baseline, not its subscription: the row
    // has moved since, so the next full turn is watched from its start and is
    // reported once.
    expect(page.watchTurn("a", 6)).toEqual([
      { sessionId: "a", title: "Чат a", at: 8 },
    ]);
    expect(page.see([chat("a", false)], { now: 9 })).toEqual([]);
  });

  it("arms a chat on its own row moving, not on the list waking up", () => {
    const page = openPage();
    page.see([chat("a", false), chat("b", false)], { now: 1 });
    // Both chats are idle across the gap. The list comes back with the other
    // chat running: that is news about that chat alone, so this one still holds
    // an idle read through the gap and cannot credit a start.
    expect(
      page.see([chat("a", false), chat("b", false)], { now: 2, paused: true }),
    ).toEqual([]);
    expect(page.see([chat("a", false), chat("b", true)], { now: 3 })).toEqual(
      [],
    );
    expect(page.watchTurn("a", 4)).toEqual([]);
    // Moving is what ends the hold, and the run it ends is the one this page
    // could not account for: the turn after it begins from an idle read over the
    // live link, and is reported.
    expect(page.watchTurn("a", 7)).toEqual([
      { sessionId: "a", title: "Чат a", at: 9 },
    ]);
  });

  it("loses a watched run across a gap it cannot vouch for", () => {
    const page = openPage();
    page.see([chat("a", false)], { now: 1 });
    page.see([chat("a", true)], { now: 2 });
    // The turn was still running while the link was down. The page cannot tell
    // that run from one that started and was not seen starting during the gap,
    // so the end it reads after the link returns is not its news either.
    expect(page.see([chat("a", true)], { now: 3, paused: true })).toEqual([]);
    expect(page.see([chat("a", true)], { now: 4 })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 5 })).toEqual([]);
    // What the gap took was this page's evidence, not its subscription: the next
    // turn, seen from its start, is reported again.
    expect(page.watchTurn("a", 6)).toEqual([
      { sessionId: "a", title: "Чат a", at: 8 },
    ]);
  });

  it("does not credit a start read while the link is down", () => {
    const page = openPage();
    page.see([chat("a", false)], { now: 1 });
    // The chat appears running in a frame the browser cannot vouch for, and the
    // link only returns afterwards.
    expect(page.see([chat("a", true)], { now: 2, paused: true })).toEqual([]);
    expect(page.see([chat("a", true)], { now: 3 })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 4 })).toEqual([]);
    expect(page.watchTurn("a", 5)).toEqual([
      { sessionId: "a", title: "Чат a", at: 7 },
    ]);
  });

  it("leaves the trusted idle behind when the link goes down", () => {
    const page = openPage();
    page.see([chat("a", false)], { now: 1 });
    // The reader queued a question before the drop and it goes out on the
    // recovered link: the chat is idle in the stale frame and running in the
    // first live one. Which run the page is looking at is not something the
    // frame it cannot vouch for can settle, so this turn goes unreported too —
    // what a browser may claim across a gap is #479.
    expect(page.see([chat("a", false)], { now: 2, paused: true })).toEqual([]);
    expect(page.see([chat("a", true)], { now: 3 })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 4 })).toEqual([]);
    // The link holding is enough to watch the next turn begin.
    expect(page.watchTurn("a", 5)).toEqual([
      { sessionId: "a", title: "Чат a", at: 7 },
    ]);
  });

  // A reconnect splits into two edges the page is told about separately: the
  // link coming back, and the Host's refreshed list arriving over it. The order
  // between them is the Host's business, not the page's, so both of them are
  // set by hand here, one each way (#479).
  it("stays silent however late the refreshed list lands after an offline ending", () => {
    const page = openPage();
    page.see([chat("a", true)], { now: 1 });
    page.see([chat("a", true)], { now: 2, paused: true });
    // The link is back first and the answer follows it, so the list the page
    // already held goes by in more than one frame. No fixed count of frames
    // marks this generation's first list, and none of them may settle a turn
    // the page did not watch end.
    for (const now of [3, 4, 5, 6]) {
      expect(page.see([chat("a", true)], { now })).toEqual([]);
      expect(page.seen.get("a")).toBe("unwatched");
    }
    // The refreshed list does land, and even it owes nothing.
    expect(page.see([chat("a", false)], { now: 7 })).toEqual([]);
  });

  it("keeps a delayed refresh of several offline endings off the stack", () => {
    const page = openPage();
    const running = [chat("a", true), chat("b", true), chat("c", true)];
    const idle = [chat("a", false), chat("b", false), chat("c", false)];
    // All three turns end while the page cannot reach the Host, and every frame
    // it holds during the gap still says they are running.
    page.see(running, { now: 1 });
    page.see(running, { now: 2, paused: true });
    // The link returns carrying the held list; the refresh of the three endings
    // lands after it. Answering one late list must not read as three finished
    // turns.
    expect(page.see(running, { now: 3 })).toEqual([]);
    expect(page.see(idle, { now: 4 })).toEqual([]);
    // The page is watching this generation now, so the next turn it sees begin
    // is reported — once, and only for that chat.
    expect(page.watchTurn("b", 5)).toEqual([
      { sessionId: "b", title: "Чат b", at: 7 },
    ]);
  });

  it("waits for the restored link's own list when the refresh landed first", () => {
    const page = openPage();
    page.see([chat("a", true)], { now: 1 });
    // The Host's answer reaches the page while it still reports itself
    // reconnecting: the link-ready edge comes after it, so that list is one this
    // generation never delivered.
    expect(page.see([chat("a", false)], { now: 2, paused: true })).toEqual([]);
    expect(page.see([chat("a", false)], { now: 3 })).toEqual([]);
    expect(page.seen.get("a")).toBe("idle");
    // From here the page is watching: the run it sees start is the run whose end
    // it reports.
    expect(page.watchTurn("a", 4)).toEqual([
      { sessionId: "a", title: "Чат a", at: 6 },
    ]);
  });

  it("keeps its own clock for a completion without an explicit one", () => {
    const page = openPage();
    page.see([chat("a", false)]);
    page.see([chat("a", true)]);
    const before = Date.now();
    const [completion] = page.see([chat("a", false)]);
    expect(completion?.at).toBeGreaterThanOrEqual(before);
  });
});
