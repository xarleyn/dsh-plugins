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
});
