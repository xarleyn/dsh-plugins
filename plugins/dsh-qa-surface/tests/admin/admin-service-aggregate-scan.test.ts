import { describe, expect, it } from "vitest";
import type { StoredSessionEvent } from "../../src/admin/conversation-log.js";
import {
  staticSessionLogReader,
  type QaSessionLogReader,
  type QaStoredSessionHeader,
} from "../../src/admin/session-log.js";
import { harness, logFor } from "./admin-service.helpers.js";

/** Let every already-scheduled continuation run. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The stored conversations of one deployment, with a counter on its reads.
 *
 * What an aggregate page really costs is the number of conversation logs it
 * opens: on a deployment with a durable store each one of them is a listing of
 * every session the deployment keeps plus a replay of the log asked for, so the
 * read count — not the response shape — is what tells a cheap page from a page
 * that takes minutes. `gated` holds each read open until the test lets it
 * finish, which is how a pass that is still running is observed.
 */
function countedStore(
  options: {
    readonly gated?: boolean;
    readonly held?: readonly string[];
  } = {},
) {
  const events: Record<string, readonly StoredSessionEvent[]> = {
    "session-alice": logFor("Release report", "Build it", "Here it is"),
    "session-bob": logFor("SQL migration", "Write it", "Done"),
    "session-carol": logFor("Flaky suite", "Fix it", "Green"),
  };
  const sessions: readonly QaStoredSessionHeader[] = Object.keys(events).map(
    (id, index) => ({ id, createdAt: 1_700_000_000_000 + index * 1_000 }),
  );
  const inner = staticSessionLogReader({
    sessions,
    events,
    ...(options.held === undefined ? {} : { held: options.held }),
  });
  const reads: string[] = [];
  const blocked: (() => void)[] = [];
  const reader: QaSessionLogReader = {
    list: () => inner.list(),
    live: (sessionId) => inner.live(sessionId),
    snapshot: (sessionId, cursor) => inner.snapshot(sessionId, cursor),
    async read(sessionId) {
      reads.push(sessionId);
      if (options.gated === true) {
        await new Promise<void>((resolve) => blocked.push(resolve));
      }
      return inner.read(sessionId);
    },
  };
  return {
    reader,
    reads,
    /** Let the oldest read still waiting finish. */
    release: () => blocked.shift()?.(),
  };
}

/** One deployment whose three conversations are all reserved and readable. */
function deployment(
  options: {
    readonly gated?: boolean;
    readonly held?: readonly string[];
    readonly clock?: { readonly now: () => number };
  } = {},
) {
  const store = countedStore(options);
  const fixtures = harness({
    sessionLog: store.reader,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  fixtures.accounts.reserveSession(fixtures.alice.token, "session-carol", {
    subroleId: "analyst",
  });
  return { ...fixtures, ...store };
}

describe("the log scan behind the aggregate pages", () => {
  it("opens every log once for the pages that share the aggregate", async () => {
    const { service, admin, reads } = deployment();
    const metrics = await service.metrics(admin.token);
    expect(metrics.conversations).toBe(3);
    expect(reads).toHaveLength(3);
    await service.overview(admin.token);
    await service.reviewQueue(admin.token, undefined, 25);
    await service.metrics(admin.token);
    // Overview, the review queue and the analytics page all count the same
    // newest logs; each of them re-opening all three is what made the console
    // take minutes per page.
    expect(reads).toHaveLength(3);
  });

  it("keeps a finished conversation and refreshes one still being written", async () => {
    let now = 1_700_000_000_000;
    const { service, admin, reads } = deployment({
      held: ["session-bob"],
      clock: { now: () => now },
    });
    await service.metrics(admin.token);
    expect(reads).toHaveLength(3);
    now += 60_000;
    await service.metrics(admin.token);
    // Only a conversation the Harness still holds can have gained a message
    // since it was last read. The others cannot change, and reading one again
    // buys nothing but another listing of every stored session.
    expect(reads).toHaveLength(4);
    expect(reads[3]).toBe("session-bob");
  });

  it("answers two pages opened together from one pass", async () => {
    const { service, admin, reads, release } = deployment({ gated: true });
    const metrics = service.metrics(admin.token);
    await tick();
    expect(reads).toHaveLength(1);
    const overview = service.overview(admin.token);
    await tick();
    // The second page joined the pass already running rather than starting a
    // second scan of the same logs.
    expect(reads).toHaveLength(1);
    for (let index = 0; index < 3; index += 1) {
      release();
      await tick();
    }
    const [counts, view] = await Promise.all([metrics, overview]);
    expect(reads).toHaveLength(3);
    expect(view.metrics).toEqual(counts);
  });

  it("gives up the pass once its last caller has left", async () => {
    const { service, admin, reads, release } = deployment({ gated: true });
    const controller = new AbortController();
    const metrics = service.metrics(admin.token, controller.signal);
    await tick();
    expect(reads).toHaveLength(1);
    controller.abort();
    release();
    await expect(metrics).rejects.toThrow(/abandoned/u);
    // The reviewer left the page: the pass stops here instead of opening the
    // logs of every remaining conversation for an answer nobody will read.
    expect(reads).toHaveLength(1);
    const counts = service.metrics(admin.token);
    for (let index = 0; index < 3; index += 1) {
      await tick();
      release();
    }
    // The abandoned pass left no trace: the next caller is answered, and the one
    // log it had already read is still reused.
    expect((await counts).conversations).toBe(3);
    expect(reads).toHaveLength(3);
  });

  it("lists a page of conversations without reading the rest", async () => {
    const { service, admin, reads } = deployment();
    const page = await service.conversations(admin.token, {}, undefined, 1);
    expect(page.total).toBe(3);
    // Nothing was searched for, so no filter here needs a log: only the one row
    // the page shows is projected. Reading a log per conversation to build a
    // page of one used to cost the whole store.
    expect(reads).toHaveLength(1);
  });

  it("reads a log per candidate while a search may match its title", async () => {
    const { service, admin, reads } = deployment();
    const page = await service.conversations(
      admin.token,
      { search: "migration" },
      undefined,
      25,
    );
    expect(page.items.map((row) => row.conversationId)).toEqual([
      "session-bob",
    ]);
    expect(reads).toHaveLength(3);
  });
});
