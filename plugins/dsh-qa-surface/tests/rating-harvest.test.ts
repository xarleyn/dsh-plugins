import { describe, expect, it, vi } from "vitest";
import {
  collectLocalRatings,
  harvestLocalRatings,
  ratingsHarvested,
  type HarvestStorage,
} from "../src/client/rating-harvest.js";
import type { QaFeedbackHarvestEntry } from "../src/types.js";

const NAMESPACE = "dsh-qa-surface.session:v1:/qa";
const MARKER = `${NAMESPACE}:ratings-harvested:u-1`;

function store(initial: Readonly<Record<string, string>>): HarvestStorage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function ratingsOf(
  sessionId: string,
  ratings: Record<string, string>,
): Readonly<Record<string, string>> {
  return {
    [`${NAMESPACE}:chat:${sessionId}:ratings`]: JSON.stringify(ratings),
  };
}

function harvested(
  storage: HarvestStorage,
  ownedIds: readonly string[] = ["s-1"],
) {
  const send = vi.fn(async (batch: readonly QaFeedbackHarvestEntry[]) => ({
    ok: true as const,
    value: { recorded: batch.length, present: 0, rejected: 0 },
  }));
  return {
    send,
    run: () =>
      harvestLocalRatings({
        storage,
        namespace: NAMESPACE,
        accountId: "u-1",
        ownedIds,
        send,
      }),
  };
}

describe("QA rating harvest", () => {
  it("addresses each stored thumbs by the log position it was given at", () => {
    const storage = store({
      ...ratingsOf("s-1", { "assistant:21": "up", "assistant:22": "down" }),
      ...ratingsOf("s-2", { "assistant:5": "up" }),
      [`${NAMESPACE}:chats`]: "[]",
    });
    expect(collectLocalRatings(storage, NAMESPACE)).toEqual([
      { conversationId: "s-1", messageId: "21", rating: "positive" },
      { conversationId: "s-1", messageId: "22", rating: "negative" },
      { conversationId: "s-2", messageId: "5", rating: "positive" },
    ]);
  });

  it("leaves a rating no log position can be traced to", () => {
    const storage = store({
      ...ratingsOf("s-1", {
        "user:20": "up",
        "work:3": "down",
        "assistant:partial:4:1": "up",
        "assistant:answer-uuid": "up",
        "assistant:23": "sideways",
        "assistant:24": "up",
      }),
    });
    expect(collectLocalRatings(storage, NAMESPACE)).toEqual([
      { conversationId: "s-1", messageId: "24", rating: "positive" },
    ]);
  });

  it("reads only the given namespace, and survives a map it cannot parse", () => {
    const storage = store({
      ["other.deployment:v1:/qa:chat:s-9:ratings"]: '{"assistant:1":"up"}',
      [`${NAMESPACE}:chat:s-8:ratings`]: "not json",
      [`${NAMESPACE}:chat:s-8`]: '{"assistant:2":"up"}',
      [`${NAMESPACE}:chat::ratings`]: '{"assistant:3":"up"}',
      ...ratingsOf("s-1", { "assistant:1": "up" }),
    });
    expect(collectLocalRatings(storage, NAMESPACE)).toEqual([
      { conversationId: "s-1", messageId: "1", rating: "positive" },
    ]);
  });

  it("offers the ratings of the chats the account owns", async () => {
    const storage = store({
      ...ratingsOf("s-1", { "assistant:21": "up" }),
      ...ratingsOf("s-2", { "assistant:5": "down" }),
    });
    const { send, run } = harvested(storage, ["s-1"]);
    expect(await run()).toEqual({
      status: "harvested",
      entries: 1,
      recorded: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([
      { conversationId: "s-1", messageId: "21", rating: "positive" },
    ]);
    expect(storage.getItem(MARKER)).toBe("1");
  });

  it("splits a browser's whole map into requests", async () => {
    const many: Record<string, string> = {};
    for (let position = 1; position <= 120; position += 1) {
      many[`assistant:${position}`] = "up";
    }
    const storage = store(ratingsOf("s-1", many));
    const { send, run } = harvested(storage);
    expect(await run()).toMatchObject({ status: "harvested", entries: 120 });
    expect(
      send.mock.calls.map((call) => (call[0] as unknown[]).length),
    ).toEqual([100, 20]);
  });

  it("reads an account out once, and only once", async () => {
    const storage = store(ratingsOf("s-1", { "assistant:21": "up" }));
    const first = harvested(storage);
    await first.run();
    const second = harvested(storage);
    expect(await second.run()).toEqual({
      status: "already-harvested",
      entries: 0,
      recorded: 0,
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("marks an account with nothing to offer as read", async () => {
    const storage = store({});
    const { send, run } = harvested(storage);
    expect(await run()).toMatchObject({ status: "nothing-to-harvest" });
    expect(send).not.toHaveBeenCalled();
    expect(ratingsHarvested(storage, NAMESPACE, "u-1")).toBe(true);
  });

  it("leaves the marker unset when a request fails, so the next login retries", async () => {
    const many: Record<string, string> = {};
    for (let position = 1; position <= 120; position += 1) {
      many[`assistant:${position}`] = "up";
    }
    const storage = store(ratingsOf("s-1", many));
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: { recorded: 100, present: 0, rejected: 0 },
      })
      .mockResolvedValueOnce({ ok: false as const, error: "offline" });
    expect(
      await harvestLocalRatings({
        storage,
        namespace: NAMESPACE,
        accountId: "u-1",
        ownedIds: ["s-1"],
        send,
      }),
    ).toMatchObject({ status: "failed", entries: 120, recorded: 100 });
    expect(ratingsHarvested(storage, NAMESPACE, "u-1")).toBe(false);
  });
});
