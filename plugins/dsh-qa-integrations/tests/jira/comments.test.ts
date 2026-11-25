import { credentialFor, providerFor, stub } from "./shared.js";

describe("jira comments", () => {
  const COMMENT = {
    id: "30001",
    author: { accountId: "5b10ac8d82e05b22cc7d4ef6", displayName: "Bob" },
    body: {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Fixed" }] },
      ],
    },
    visibility: { type: "role", value: "Administrators" },
    created: "2026-09-01T09:00:00.000+0300",
    updated: "2026-09-01T10:00:00.000+0300",
  };

  it("orders newest first by default and pages by position", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { comments: [COMMENT], startAt: 0, maxResults: 50, total: 3 },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.comments",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/issue/PROJ-123/comment");
    expect(calls[0]?.url.searchParams.get("orderBy")).toBe("-created");
    expect(calls[0]?.url.searchParams.get("maxResults")).toBe("100");
    expect(answer["pagination"]).toEqual({
      startAt: 0,
      returned: 1,
      total: 3,
      hasMore: true,
      nextStartAt: 1,
    });
    const items = answer["items"] as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      id: "30001",
      body: "Fixed",
      visibility: { type: "role", value: "Administrators" },
      author: { accountId: "5b10ac8d82e05b22cc7d4ef6", displayName: "Bob" },
    });

    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.comments",
      { issueKey: "PROJ-123", order: "oldest", startAt: 2, limit: 10 },
    );
    expect(calls[1]?.url.searchParams.get("orderBy")).toBe("created");
    expect(calls[1]?.url.searchParams.get("startAt")).toBe("2");
    expect(calls[1]?.url.searchParams.get("maxResults")).toBe("10");
  });

  it("reads consecutive pages from the advertised offset, stopping on the last or empty page", async () => {
    const { fetcher } = stub((url) => {
      const offset = Number(url.searchParams.get("startAt"));
      return {
        json: {
          total: offset === 2 ? 4 : 2,
          comments: offset < 2 ? [{ ...COMMENT, id: String(offset + 1) }] : [],
        },
      };
    });
    const provider = providerFor(fetcher);
    const page = async (startAt: number) =>
      (await provider.execute(
        { credential: credentialFor(provider) },
        "issues.comments",
        { issueKey: "PROJ-123", startAt, limit: 1 },
      )) as {
        items: { id: string }[];
        pagination: { nextStartAt?: number; hasMore: boolean };
      };
    const first = await page(0);
    expect(first.pagination.nextStartAt).toBe(1);
    const last = await page(first.pagination.nextStartAt!);
    expect([first.items[0]?.id, last.items[0]?.id]).toEqual(["1", "2"]);
    expect(last.pagination.hasMore).toBe(false);
    expect(last.pagination.nextStartAt).toBeUndefined();
    const empty = await page(2);
    expect(empty.pagination.hasMore).toBe(false);
    expect(empty.pagination.nextStartAt).toBeUndefined();
  });

  it("refuses an order Jira does not take", async () => {
    const { fetcher, calls } = stub(() => ({ json: { comments: [] } }));
    const provider = providerFor(fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "issues.comments",
        {
          issueKey: "PROJ-123",
          order: "random",
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toEqual([]);
  });

  it("continues a full page without a total and stops when the next one is empty", async () => {
    const { fetcher } = stub((url) => ({
      json: {
        comments:
          Number(url.searchParams.get("startAt")) === 0 ? [COMMENT] : [],
      },
    }));
    const provider = providerFor(fetcher);
    const context = { credential: credentialFor(provider) };
    const input = { issueKey: "PROJ-123", limit: 1 };
    const first = await provider.execute(context, "issues.comments", input);
    expect(first).toMatchObject({
      pagination: { hasMore: true, nextStartAt: 1 },
    });
    const last = await provider.execute(context, "issues.comments", {
      ...input,
      startAt: 1,
    });
    expect(last).toMatchObject({ pagination: { startAt: 1, hasMore: false } });
    expect(last).not.toHaveProperty("pagination.nextStartAt");
  });
});
