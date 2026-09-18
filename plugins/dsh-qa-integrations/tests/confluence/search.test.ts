import {
  modifiedAfterDate,
  pageLimit,
} from "../../src/providers/confluence/operations.js";
import { call, config, stub } from "./shared.js";

describe("confluence search", () => {
  it("builds the CQL from typed filters and never takes raw CQL", async () => {
    const { calls, fetcher } = stub(() => ({
      json: { results: [], start: 0, limit: 20, size: 0, totalSize: 0 },
    }));
    await call(
      "search.run",
      {
        query: 'deploy "roll back"',
        spaces: ["eng"],
        contentTypes: ["page", "blogpost"],
        labels: ["runbook", "release"],
        creator: "me",
        contributor: "acc-bob",
        modifiedAfter: "2026-09-01",
        orderBy: "lastmodified",
        limit: 5,
        cursor: "40",
      },
      { fetcher },
    );
    const url = calls[0]?.url as URL;
    expect(url.pathname).toBe("/wiki/rest/api/search");
    expect(url.searchParams.get("cql")).toBe(
      'type in (page, blogpost) AND space in ("ENG") AND label in ("runbook", "release") AND text ~ "deploy \\"roll back\\"" AND lastmodified >= "2026-09-01" AND creator = currentUser() AND contributor = "acc-bob" ORDER BY lastmodified DESC',
    );
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("start")).toBe("40");
    expect(url.searchParams.get("includeArchivedSpaces")).toBeNull();
  });

  it("defaults to pages and to the deployment row budget", async () => {
    const { calls, fetcher } = stub(() => ({ json: { results: [] } }));
    await call("search.run", {}, { fetcher });
    const url = calls[0]?.url as URL;
    expect(url.searchParams.get("cql")).toBe("type in (page)");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("start")).toBe("0");
    await call("search.run", { limit: 999 }, { fetcher });
    // Above the deployment ceiling the answer is clamped, not refused.
    expect((calls[1]?.url as URL).searchParams.get("limit")).toBe("50");
    await call(
      "search.run",
      { limit: 5 },
      { fetcher, confluence: { maxResults: 3 } },
    );
    expect((calls[2]?.url as URL).searchParams.get("limit")).toBe("3");
    expect(pageLimit(undefined, config().confluence)).toBe(20);
  });

  it("resolves a relative window against the provider's own clock", async () => {
    const today = new Date("2026-09-16T12:00:00Z");
    // The question "what changed this week" is the common one, and an agent
    // whose prompt carries no clock cannot turn it into a date itself.
    expect(modifiedAfterDate("-7d", today)).toBe("2026-09-09");
    expect(modifiedAfterDate("-2w", today)).toBe("2026-09-02");
    expect(modifiedAfterDate("-1m", today)).toBe("2026-08-17");
    expect(modifiedAfterDate("-1y", today)).toBe("2025-09-16");
    // An absolute day still passes through untouched.
    expect(modifiedAfterDate("2026-09-01", today)).toBe("2026-09-01");
    expect(modifiedAfterDate(undefined, today)).toBeUndefined();
    for (const bad of ["-0d", "-1h", "yesterday", "2026-09", "-4000d", "-1"]) {
      expect(() => modifiedAfterDate(bad, today)).toThrow(
        /modifiedAfter is invalid/u,
      );
    }

    const { calls, fetcher } = stub(() => ({ json: { results: [] } }));
    await call("search.run", { modifiedAfter: "-7d" }, { fetcher });
    expect((calls[0]?.url as URL).searchParams.get("cql")).toBe(
      `type in (page) AND lastmodified >= "${new Date(
        Date.now() - 7 * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)}"`,
    );
  });

  it("maps archived results onto the option Confluence has for them", async () => {
    const { calls, fetcher } = stub(() => ({ json: { results: [] } }));
    await call("search.run", { includeArchived: true }, { fetcher });
    expect(
      (calls[0]?.url as URL).searchParams.get("includeArchivedSpaces"),
    ).toBe("true");
  });

  it("projects results with their space, a plain excerpt and the next cursor", async () => {
    const { fetcher } = stub(() => ({
      json: {
        results: [
          {
            content: {
              id: "123456",
              type: "page",
              status: "current",
              title: "Deployment Guide",
            },
            title: "Deployment Guide",
            excerpt:
              'Steps to <span class="search-highlight">deploy</span> &amp; roll back',
            url: "/spaces/ENG/pages/123456/Deployment+Guide",
            resultGlobalContainer: {
              title: "Engineering",
              displayUrl: "/spaces/ENG",
            },
            lastModified: "2026-09-10T09:00:00.000Z",
          },
        ],
        start: 0,
        limit: 20,
        size: 1,
        totalSize: 3,
      },
    }));
    const answer = (await call("search.run", {}, { fetcher })) as Record<
      string,
      unknown
    >;
    expect(answer["source"]).toEqual({
      provider: "confluence",
      site: "https://company.atlassian.net",
    });
    expect(answer["items"]).toEqual([
      {
        id: "123456",
        type: "page",
        title: "Deployment Guide",
        space: { key: "ENG", name: "Engineering" },
        modifiedAt: "2026-09-10T09:00:00.000Z",
        url: "https://company.atlassian.net/wiki/spaces/ENG/pages/123456/Deployment+Guide",
        untrustedContent: {
          format: "text",
          excerpt: "Steps to deploy & roll back",
        },
      },
    ]);
    expect(answer["nextCursor"]).toBe("1");
    expect(answer["totalSize"]).toBe(3);
  });

  it("stops handing out a cursor when the last row arrived", async () => {
    const { fetcher } = stub(() => ({
      json: {
        results: [
          { content: { id: "1", type: "page" }, url: "/spaces/ENG/pages/1" },
        ],
        start: 0,
        size: 1,
        totalSize: 1,
      },
    }));
    const answer = (await call("search.run", {}, { fetcher })) as Record<
      string,
      unknown
    >;
    expect(answer["nextCursor"]).toBeUndefined();

    // An empty page is the end of the search, even when the count upstream
    // still claims more: a cursor equal to the offset just asked for would be
    // a loop, not a continuation.
    const empty = stub(() => ({
      json: { results: [], start: 40, totalSize: 50 },
    }));
    const exhausted = (await call(
      "search.run",
      { cursor: "40" },
      { fetcher: empty.fetcher },
    )) as Record<string, unknown>;
    expect(exhausted["nextCursor"]).toBeUndefined();
  });

  it("leaves the URL out when the site cannot be named", async () => {
    const { fetcher } = stub(() => ({
      json: {
        results: [{ content: { id: "1" }, url: "/spaces/ENG/pages/1" }],
        totalSize: 1,
      },
    }));
    const answer = (await call(
      "search.run",
      {},
      {
        fetcher,
        confluence: {
          instances: [
            {
              id: "gateway",
              label: "Scoped",
              baseUrl: "https://api.atlassian.com/ex/confluence/cloud-1",
            },
          ],
        },
        instanceId: "gateway",
      },
    )) as Record<string, unknown>;
    const items = answer["items"] as Record<string, unknown>[];
    expect(items[0]?.["url"]).toBeUndefined();
  });

  it("refuses a space outside the operator allowlist", async () => {
    const { calls, fetcher } = stub(() => ({ json: { results: [] } }));
    await expect(
      call(
        "search.run",
        { spaces: ["HR"] },
        { fetcher, confluence: { allowedSpaces: ["ENG"] } },
      ),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
    expect(calls).toHaveLength(0);
  });

  it("narrows an open search to the allowlist and drops foreign rows", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        results: [
          {
            content: { id: "1", space: { key: "ENG" } },
            url: "/spaces/ENG/pages/1",
          },
          {
            content: { id: "2", space: { key: "HR" } },
            url: "/spaces/HR/pages/2",
          },
          // No container field at all: the space of this row cannot be
          // established, so it is dropped instead of handed over.
          { content: { id: "4" }, url: "/pages/4" },
        ],
        totalSize: 3,
      },
    }));
    const answer = (await call(
      "search.run",
      {},
      { fetcher, confluence: { allowedSpaces: ["ENG"] } },
    )) as Record<string, unknown>;
    expect((calls[0]?.url as URL).searchParams.get("cql")).toBe(
      'type in (page) AND space in ("ENG")',
    );
    // The row Confluence labelled HR never travels, and a row whose space the
    // answer does not name is dropped rather than shown: the policy is
    // enforced on what the provider can prove, not on what it hopes.
    expect(
      (answer["items"] as Record<string, unknown>[]).map((item) => item["id"]),
    ).toEqual(["1"]);
  });
});
