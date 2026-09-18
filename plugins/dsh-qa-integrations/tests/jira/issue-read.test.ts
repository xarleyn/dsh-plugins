import {
  issueFields,
  requestedIncludes,
} from "../../src/providers/jira/operations.js";
import {
  type StubResult,
  config,
  credentialFor,
  providerFor,
  stub,
} from "./shared.js";

describe("jira issue read", () => {
  const ADF = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Timeout in checkout" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "reproduced on staging" }],
              },
            ],
          },
        ],
      },
    ],
  };

  const ISSUE = {
    id: "10001",
    key: "PROJ-123",
    fields: {
      summary: "Payment timeout",
      description: ADF,
      status: { id: "3", name: "In Progress" },
      project: { id: "10", key: "PROJ", name: "Medical" },
      issuelinks: [
        {
          type: { name: "Blocks" },
          outwardIssue: { key: "PROJ-200", fields: { summary: "Release" } },
        },
      ],
      subtasks: [{ key: "PROJ-124", fields: { summary: "Add a test" } }],
      attachment: [
        {
          id: "20001",
          filename: "trace.txt",
          mimeType: "text/plain",
          size: 1024,
          author: {
            accountId: "5b10ac8d82e05b22cc7d4ef5",
            displayName: "Alice",
          },
          created: "2026-09-01T09:00:00.000+0300",
        },
      ],
      comment: { total: 3, comments: [{ id: "1" }] },
      customfield_10010: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Severity: high" }],
          },
        ],
      },
      customfield_10011: { value: "Gold", id: "5" },
    },
  };

  function issue(
    extra: (url: URL) => StubResult | undefined = () => undefined,
  ) {
    return stub((url) => {
      const decided = extra(url);
      if (decided !== undefined) return decided;
      if (url.pathname.endsWith("/field")) {
        return {
          json: [
            { id: "customfield_10010", name: "Notes", custom: true },
            { id: "customfield_10011", name: "Tier", custom: true },
          ],
        };
      }
      if (url.pathname.includes("/issue/")) return { json: ISSUE };
      return { status: 404, json: { errorMessages: ["not found"] } };
    });
  }

  it("asks for the compact card by default and renders the description", async () => {
    const { fetcher, calls } = issue();
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "proj-123" },
    )) as Record<string, unknown>;
    // The key is canonicalized on the way out, so the URL is the one Jira owns.
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/issue/PROJ-123");
    expect(calls[0]?.url.searchParams.get("fields")).not.toContain("*all");
    expect(answer["key"]).toBe("PROJ-123");
    expect(answer["description"]).toBe(
      "Timeout in checkout\n- reproduced on staging",
    );
    // Nothing was asked for, so nothing optional came back.
    expect(answer["attachments"]).toBeUndefined();
    expect(answer["customFields"]).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("adds relations, attachments and a comment count when asked", async () => {
    const { fetcher, calls } = issue();
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      {
        issueKey: "PROJ-123",
        include: ["relations", "attachments", "comments_summary"],
      },
    )) as Record<string, unknown>;
    const fields = calls[0]?.url.searchParams.get("fields") ?? "";
    expect(fields).toContain("attachment");
    expect(fields).toContain("issuelinks");
    expect(fields).toContain("comment");
    expect(answer["parent"]).toBeUndefined();
    expect(answer["subtasks"]).toEqual([
      {
        key: "PROJ-124",
        url: "https://company.atlassian.net/browse/PROJ-124",
        summary: "Add a test",
      },
    ]);
    expect(answer["links"]).toEqual([
      {
        type: "Blocks",
        direction: "outward",
        key: "PROJ-200",
        summary: "Release",
      },
    ]);
    expect(answer["attachments"]).toEqual([
      {
        id: "20001",
        filename: "trace.txt",
        mimeType: "text/plain",
        size: 1024,
        author: { accountId: "5b10ac8d82e05b22cc7d4ef5", displayName: "Alice" },
        createdAt: "2026-09-01T09:00:00.000+0300",
      },
    ]);
    expect(answer["comments"]).toEqual({ total: 3, returned: 1 });
  });

  it("names custom fields from the site schema, without caching across calls", async () => {
    const { fetcher, calls } = issue();
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123", include: ["custom_fields"] },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.searchParams.get("fields")).toBe("*all");
    expect(calls[1]?.url.pathname).toBe("/rest/api/3/field");
    expect(answer["customFields"]).toEqual({
      Notes: "Severity: high",
      Tier: { id: "5", value: "Gold" },
    });

    // A second read asks again: nothing is kept between calls, so a field the
    // user may no longer see cannot come back from a cache.
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123", include: ["custom_fields"] },
    );
    expect(
      calls.filter((call) => call.url.pathname.endsWith("/field")),
    ).toHaveLength(2);
  });

  it("refuses custom fields when the deployment switched the catalog off", async () => {
    const { fetcher, calls } = issue();
    const provider = providerFor(fetcher, { fieldsRead: false });
    await expect(
      provider.execute({ credential: credentialFor(provider) }, "issues.get", {
        issueKey: "PROJ-123",
        include: ["custom_fields"],
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toEqual([]);
  });

  it("refuses an issue key that is not one", async () => {
    const { fetcher } = issue();
    const provider = providerFor(fetcher);
    await expect(
      provider.execute({ credential: credentialFor(provider) }, "issues.get", {
        issueKey: "PROJ-123/../../admin",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("keeps the field selector an allow-list per include group", () => {
    expect(issueFields(["description"], config().jira)).toContain("summary");
    expect(issueFields(["description"], config().jira)).toContain(
      "description",
    );
    expect(issueFields([], config().jira)).not.toContain("description");
    expect(requestedIncludes(undefined)).toEqual(["description"]);
    expect(requestedIncludes(["attachments", "attachments"])).toEqual([
      "attachments",
    ]);
    expect(() => requestedIncludes(["everything"])).toThrow(
      /include is invalid/u,
    );
    expect(() => requestedIncludes([])).toThrow(/include is invalid/u);
  });
});
