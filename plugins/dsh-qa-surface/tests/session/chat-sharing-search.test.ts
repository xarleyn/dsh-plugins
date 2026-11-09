import { describe, expect, it, vi } from "vitest";
import { QaChatTransport } from "../../src/chat-sharing/transport.js";

function fixture() {
  let ids = Array.from({ length: 23 }, (_, n) => `own-${n}`);
  const hit = (id: string) => ({
    header: { id },
    bestMatch: {
      sessionId: id,
      type: "user/message",
      surface: "current",
      snippet: `match ${id}`,
    },
  });
  const searchSessions = vi.fn(async (request: { cursor?: string }) =>
    request.cursor === undefined
      ? {
          items: ids.slice(0, 10).map(hit),
          nextCursor: "next",
        }
      : { items: ids.slice(10).map(hit) },
  );
  const nativeSearch = vi.fn(async () => ({
    items: Array.from({ length: 20 }, (_, n) => ({
      sessionId: `foreign-${n}`,
      snippet: "match",
    })),
    hasMore: true,
  }));
  const transport = new QaChatTransport(
    {
      get: () => ({ searchSessions }),
      sessionController: {
        list: async () => ({ items: ids.map((sessionId) => ({ sessionId })) }),
        search: nativeSearch,
      },
    } as never,
    () =>
      ({
        visible: () => ids.map((sessionId) => ({ sessionId, mode: "owner" })),
      }) as never,
    async () => {},
  );
  return {
    transport,
    searchSessions,
    nativeSearch,
    hit,
    revoke: () => {
      ids = [];
    },
  };
}

describe("account-scoped message search", () => {
  it("finds own results beyond the global top twenty, paginates, and reports the twenty-first own result", async () => {
    const f = fixture();
    const result = await f.transport.search(
      "token",
      { query: "match" },
      new AbortController().signal,
    );
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(f.nativeSearch).not.toHaveBeenCalled();
    expect(f.searchSessions).toHaveBeenCalledTimes(2);
    expect(f.searchSessions.mock.calls[0]![0]).toMatchObject({
      sessionFilters: [
        { kind: "id", values: expect.arrayContaining(["own-0", "own-22"]) },
      ],
    });
  });

  it("withholds snippets when a recipient loses access during the provider read", async () => {
    const f = fixture();
    f.searchSessions.mockImplementationOnce(async () => {
      f.revoke();
      return { items: [f.hit("own-0")] };
    });
    expect(
      await f.transport.search(
        "token",
        { query: "match" },
        new AbortController().signal,
      ),
    ).toEqual({ items: [], hasMore: false });
  });

  it("refuses a repeated cursor and aborts before another provider page", async () => {
    const f = fixture();
    f.searchSessions.mockResolvedValue({ items: [], nextCursor: "repeat" });
    await expect(
      f.transport.search(
        "token",
        { query: "match" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/cursor/u);
    expect(f.searchSessions).toHaveBeenCalledTimes(2);
    f.searchSessions.mockClear();
    const abort = new AbortController();
    f.searchSessions.mockImplementationOnce(async () => {
      abort.abort();
      return { items: [], nextCursor: "next" };
    });
    await expect(
      f.transport.search("token", { query: "match" }, abort.signal),
    ).rejects.toThrow();
    expect(f.searchSessions).toHaveBeenCalledOnce();
  });

  it("reports no more results after an empty final page, instead of trusting a provider cursor", async () => {
    const f = fixture();
    f.searchSessions
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => f.hit(`own-${i}`)),
        nextCursor: "last",
      })
      .mockResolvedValueOnce({ items: [] });
    const result = await f.transport.search(
      "token",
      { query: "match" },
      new AbortController().signal,
    );
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(false);
  });

  it("bounds changing cursors and stale-cursor restart loops", async () => {
    const f = fixture();
    let page = 0;
    f.searchSessions.mockImplementation(async () => ({
      items: [],
      nextCursor: `page-${++page}`,
    }));
    await expect(
      f.transport.search(
        "token",
        { query: "match" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/bounded page budget/u);
    expect(f.searchSessions).toHaveBeenCalledTimes(100);
    f.searchSessions.mockClear();
    f.searchSessions.mockImplementation(async (request) => {
      if (request.cursor !== undefined)
        throw Object.assign(new Error("stale"), {
          code: "SESSION_QUERY_STALE_CURSOR",
        });
      return { items: [], nextCursor: "stale" };
    });
    await expect(
      f.transport.search(
        "token",
        { query: "match" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/bounded page budget/u);
    expect(f.searchSessions).toHaveBeenCalledTimes(100);
  });
});
