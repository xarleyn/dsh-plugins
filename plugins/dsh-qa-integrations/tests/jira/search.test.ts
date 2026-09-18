import { type StubResult, credentialFor, providerFor, stub } from "./shared.js";

describe("jira search", () => {
  const ISSUE = {
    id: "10001",
    key: "PROJ-123",
    fields: {
      summary: "Payment timeout",
      status: {
        id: "3",
        name: "In Progress",
        statusCategory: { name: "In Progress" },
      },
      priority: { id: "2", name: "High" },
      assignee: { accountId: "5b10ac8d82e05b22cc7d4ef5", displayName: "Alice" },
      reporter: { accountId: "5b10ac8d82e05b22cc7d4ef6", displayName: "Bob" },
      labels: ["regression"],
      created: "2026-09-01T09:00:00.000+0300",
      updated: "2026-09-02T09:00:00.000+0300",
      duedate: "2026-09-10",
      project: { id: "10", key: "PROJ", name: "Medical" },
      issuetype: { id: "10002", name: "Bug" },
      parent: { id: "10000", key: "PROJ-100", fields: { summary: "Epic" } },
    },
  };

  function search(result: StubResult = {}) {
    return stub((url) => {
      if (!url.pathname.endsWith("/search/jql")) {
        return { status: 404, json: { errorMessages: ["wrong endpoint"] } };
      }
      return {
        json: {
          issues: [ISSUE],
          isLast: false,
          nextPageToken: "tok-2",
          ...(result.json as object),
        },
        ...result,
      };
    });
  }

  it("reads the endpoint Jira Cloud serves today", async () => {
    const { fetcher, calls } = search();
    const provider = providerFor(fetcher);
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      { query: "payment" },
    );
    const call = calls[0];
    expect(call?.url.pathname).toBe("/rest/api/3/search/jql");
    expect(call?.url.searchParams.get("jql")).toBe(
      'text ~ "payment" ORDER BY updated DESC',
    );
    expect(call?.url.searchParams.get("maxResults")).toBe("20");
    expect(call?.url.searchParams.get("fields")).toContain("summary");
    expect(call?.url.pathname).not.toBe("/rest/api/3/search");
  });

  it("answers with the compact card and Jira's own cursor", async () => {
    const { fetcher } = search();
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      { query: "payment" },
    )) as Record<string, unknown>;
    const items = answer["items"] as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "PROJ-123",
      url: "https://company.atlassian.net/browse/PROJ-123",
      summary: "Payment timeout",
      status: { id: "3", name: "In Progress", category: "In Progress" },
      priority: { id: "2", name: "High" },
      assignee: { accountId: "5b10ac8d82e05b22cc7d4ef5", displayName: "Alice" },
      labels: ["regression"],
      dueAt: "2026-09-10",
      project: { id: "10", key: "PROJ", name: "Medical" },
      issueType: { id: "10002", name: "Bug" },
    });
    expect(answer["pagination"]).toEqual({
      returned: 1,
      isLast: false,
      nextCursor: "tok-2",
    });
  });

  it("lowers the page on request but never raises the deployment ceiling", async () => {
    const { fetcher, calls } = search();
    const provider = providerFor(fetcher, {
      defaultSearchLimit: 5,
      maxSearchLimit: 10,
    });
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        query: "payment",
        limit: 50,
      },
    );
    expect(calls[0]?.url.searchParams.get("maxResults")).toBe("10");
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        query: "payment",
      },
    );
    expect(calls[1]?.url.searchParams.get("maxResults")).toBe("5");
  });

  it("passes a cursor back to Jira and refuses a malformed one", async () => {
    const { fetcher, calls } = search();
    const provider = providerFor(fetcher);
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        query: "payment",
        cursor: "tok-2",
      },
    );
    expect(calls[0]?.url.searchParams.get("nextPageToken")).toBe("tok-2");
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "issues.search",
        {
          query: "payment",
          cursor: "not a cursor",
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });
});
