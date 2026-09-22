import { IntegrationError } from "../../src/errors.js";
import {
  DC,
  DC_MYSELF,
  PAT,
  credentialFor,
  dcCredentialFor,
  dcProviderFor,
  dataCenter,
  providerFor,
  stub,
} from "./shared.js";

/** One issue as `/rest/api/2` answers a search, with the fields the provider asks. */
const DC_ISSUE = {
  id: "10101",
  key: "PROJ-123",
  fields: {
    summary: "Демо-задача",
    status: {
      id: "3",
      name: "In Progress",
      statusCategory: { id: 4, name: "In Progress" },
    },
    priority: { id: "2", name: "High" },
    assignee: { name: "alice", key: "alice", displayName: "Alice Example" },
    reporter: { name: "bob", key: "bob", displayName: "Bob Example" },
    project: { id: "10000", key: "PROJ", name: "Demo" },
    issuetype: { id: "1", name: "Task" },
    labels: ["demo"],
    created: "2026-01-01T10:00:00.000+0300",
    updated: "2026-01-02T10:00:00.000+0300",
    description: "Строка вики-разметки, а не ADF",
    comment: { total: 2, comments: [] },
  },
};

/** A search answer as Data Center pages it: by offset, with the total size. */
function searchPage(startAt: number, total: number, count: number) {
  return {
    startAt,
    maxResults: 20,
    total,
    issues: Array.from({ length: count }, (_, index) => ({
      ...DC_ISSUE,
      id: String(10101 + startAt + index),
      key: `PROJ-${123 + startAt + index}`,
    })),
  };
}

describe("Jira Server / Data Center connection", () => {
  it("authenticates a personal access token as a bearer, with no e-mail", async () => {
    const { fetcher, calls } = dataCenter(() => undefined);
    const provider = dcProviderFor(fetcher);
    const validation = await provider.validate({
      credential: dcCredentialFor(provider),
    });
    expect(validation.externalUserId).toBe("alice");
    expect(validation.tenantId).toBe("https://jira.example.corp");
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${PAT}`);
    }
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/rest/api/2/myself",
      "/rest/api/2/serverInfo",
    ]);
  });

  it("accepts a personal access token that is not a valid Cloud token", () => {
    const provider = dcProviderFor(async () => new Response("{}"));
    // base64 padding and `+`/`=` are refused by the Cloud token shape.
    const credential = provider.parseCredential(PAT, { siteId: DC.id });
    expect(credential.portal).toBe("https://jira.example.corp");
    expect(JSON.parse(credential.credential)).toEqual({
      siteId: DC.id,
      email: "",
      token: PAT,
    });
    // The same token still cannot be spent on a Cloud site, where an e-mail is
    // part of the authentication.
    const cloudProvider = dcProviderFor(async () => new Response("{}"), {
      sites: [
        {
          id: "company",
          label: "",
          baseUrl: "https://company.atlassian.net",
        },
      ],
    });
    expect(() =>
      cloudProvider.parseCredential(PAT, { siteId: "company" }),
    ).toThrow(/e-mail/u);
  });

  it("refuses a Cloud site whose connection carries no account e-mail", async () => {
    const { fetcher } = dataCenter(() => undefined);
    const provider = dcProviderFor(fetcher, {
      sites: [{ id: "corp", label: "", baseUrl: "https://jira.example.corp" }],
    });
    // The operator repointed the site from server to cloud after the connection
    // was made: the stored credential — a bearer token and no account — is
    // refused instead of being sent as an empty-account Basic pair.
    const stored = JSON.stringify({ siteId: "corp", email: "", token: PAT });
    await expect(
      provider.validate({ credential: stored }),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
  });

  it("refuses a site that answers the other product, naming the fix", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/serverInfo")
        ? { json: { deploymentType: "Cloud", version: "1001.0.0" } }
        : { json: DC_MYSELF },
    );
    const provider = dcProviderFor(fetcher);
    const cause = await provider
      .validate({ credential: dcCredentialFor(provider) })
      .catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(IntegrationError);
    expect((cause as IntegrationError).code).toBe("InvalidCredential");
    expect((cause as IntegrationError).message).toContain(
      "set deploymentType: cloud",
    );
  });

  it("names the fix when a Cloud site answers Server", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/serverInfo")
        ? {
            json: {
              deploymentType: "Server",
              version: "9.13.0",
              serverTitle: "Demo Jira",
            },
          }
        : { json: DC_MYSELF },
    );
    const provider = providerFor(fetcher);
    const cause = await provider
      .validate({ credential: credentialFor(provider) })
      .catch((error: unknown) => error);
    expect((cause as IntegrationError).code).toBe("InvalidCredential");
    expect((cause as IntegrationError).message).toContain(
      "set deploymentType: server",
    );
  });

  it("leaves the identity readable when the instance serves no serverInfo", async () => {
    // A proxy or an older instance that hides the probe must not fail the
    // connection: the identity call already proved the credential works.
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/myself")
        ? { json: DC_MYSELF }
        : { status: 404, json: { errorMessages: ["not found"] } },
    );
    const provider = dcProviderFor(fetcher);
    const validation = await provider.validate({
      credential: dcCredentialFor(provider),
    });
    expect(validation.externalUserId).toBe("alice");
  });
});

describe("Jira Server / Data Center reads", () => {
  it("searches through the classic endpoint and pages by offset", async () => {
    const { fetcher, calls } = dataCenter((url) =>
      url.pathname.startsWith("/rest/api/2/search")
        ? { json: searchPage(0, 45, 20) }
        : undefined,
    );
    const provider = dcProviderFor(fetcher);
    const answer = (await provider.execute(
      { credential: dcCredentialFor(provider) },
      "issues.search",
      { projectKeys: ["PROJ"] },
    )) as Record<string, unknown>;
    const [call] = calls;
    expect(call?.url.pathname).toBe("/rest/api/2/search");
    expect(call?.url.searchParams.get("jql")).toBe(
      'project in ("PROJ") ORDER BY updated DESC',
    );
    expect(call?.url.searchParams.get("startAt")).toBe("0");
    expect(call?.url.searchParams.get("nextPageToken")).toBeNull();
    const pagination = answer["pagination"] as Record<string, unknown>;
    expect(pagination["returned"]).toBe(20);
    expect(pagination["total"]).toBe(45);
    expect(pagination["startAt"]).toBe(0);
    // The cursor is the position the next page starts at, because this product
    // reports a size instead of minting a continuation token.
    expect(pagination["nextCursor"]).toBe("20");
    const items = answer["items"] as Record<string, unknown>[];
    expect(items[0]?.["key"]).toBe("PROJ-123");
    expect(items[0]?.["url"]).toBe("https://jira.example.corp/browse/PROJ-123");
    // A person is named the way this product names them: a user name.
    const assignee = items[0]?.["assignee"] as Record<string, unknown>;
    expect(assignee).toEqual({ name: "alice", displayName: "Alice Example" });
  });

  it("continues a search from the cursor it answered with", async () => {
    const { fetcher, calls } = dataCenter((url) =>
      url.pathname.startsWith("/rest/api/2/search")
        ? { json: searchPage(Number(url.searchParams.get("startAt")), 45, 20) }
        : undefined,
    );
    const provider = dcProviderFor(fetcher);
    await provider.execute(
      { credential: dcCredentialFor(provider) },
      "issues.search",
      {
        projectKeys: ["PROJ"],
        cursor: "20",
      },
    );
    expect(calls[0]?.url.searchParams.get("startAt")).toBe("20");
  });

  it("refuses a cursor this product could not have minted", async () => {
    const { fetcher } = dataCenter(() => undefined);
    const provider = dcProviderFor(fetcher);
    await expect(
      provider.execute(
        { credential: dcCredentialFor(provider) },
        "issues.search",
        { projectKeys: ["PROJ"], cursor: "next-page-token" },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("resolves a person by their user name through the v2 directory", async () => {
    const { fetcher, calls } = dataCenter((url) => {
      if (url.pathname === "/rest/api/2/user/search") {
        return {
          json: [{ name: "ivanov", key: "ivanov", displayName: "Иван Иванов" }],
        };
      }
      if (url.pathname.startsWith("/rest/api/2/search")) {
        return { json: searchPage(0, 1, 1) };
      }
      return undefined;
    });
    const provider = dcProviderFor(fetcher);
    await provider.execute(
      { credential: dcCredentialFor(provider) },
      "issues.search",
      { assignee: "Иванов" },
    );
    const directory = calls.find((call) =>
      call.url.pathname.endsWith("/user/search"),
    );
    expect(directory?.url.searchParams.get("username")).toBe("Иванов");
    expect(directory?.url.searchParams.get("query")).toBeNull();
    const search = calls.find((call) =>
      call.url.pathname.endsWith("/rest/api/2/search"),
    );
    expect(search?.url.searchParams.get("jql")).toContain(
      'assignee = "ivanov"',
    );
  });

  it("takes a short user name as the identifier it already is", async () => {
    const { fetcher, calls } = dataCenter((url) =>
      url.pathname.startsWith("/rest/api/2/search")
        ? { json: searchPage(0, 1, 1) }
        : undefined,
    );
    const provider = dcProviderFor(fetcher);
    await provider.execute(
      { credential: dcCredentialFor(provider) },
      "issues.search",
      { assignee: "ivanov" },
    );
    // `ivanov` is too short to be a Cloud account id, but it *is* what this
    // product filters on, so no directory read is spent on it.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("jql")).toContain(
      'assignee = "ivanov"',
    );
  });

  it("reads an issue, its comments and its fields on the v2 surface", async () => {
    const { fetcher, calls } = dataCenter((url) => {
      if (url.pathname === "/rest/api/2/issue/PROJ-123") {
        return { json: DC_ISSUE };
      }
      if (url.pathname === "/rest/api/2/issue/PROJ-123/comment") {
        return {
          json: {
            startAt: 0,
            total: 1,
            comments: [
              {
                id: "1",
                author: { name: "alice", displayName: "Alice Example" },
                body: "Первая строка\nвторая строка",
                created: "2026-01-02T10:00:00.000+0300",
              },
            ],
          },
        };
      }
      if (url.pathname === "/rest/api/2/field") {
        return {
          json: [
            {
              id: "customfield_10010",
              name: "Продукт",
              custom: true,
              schema: { type: "string" },
            },
          ],
        };
      }
      return undefined;
    });
    const provider = dcProviderFor(fetcher);
    const credential = dcCredentialFor(provider);

    const issue = (await provider.execute({ credential }, "issues.get", {
      issueKey: "PROJ-123",
      include: ["description"],
    })) as Record<string, unknown>;
    // A wiki-markup body is handed over as the text it is, not as a tree.
    expect(issue["description"]).toBe("Строка вики-разметки, а не ADF");

    const comments = (await provider.execute(
      { credential },
      "issues.comments",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    const items = comments["items"] as Record<string, unknown>[];
    expect(items[0]?.["body"]).toBe("Первая строка\nвторая строка");

    const fields = (await provider.execute(
      { credential },
      "fields.list",
      {},
    )) as Record<string, unknown>;
    const rows = fields["items"] as Record<string, unknown>[];
    expect(rows[0]?.["id"]).toBe("customfield_10010");

    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/rest/api/2/issue/PROJ-123",
      "/rest/api/2/issue/PROJ-123/comment",
      "/rest/api/2/field",
    ]);
  });

  it("projects a custom field the instance keeps as plain text", async () => {
    const { fetcher } = dataCenter((url) => {
      if (url.pathname === "/rest/api/2/field") {
        return { json: [{ id: "customfield_10010", name: "Продукт" }] };
      }
      if (url.pathname === "/rest/api/2/issue/PROJ-123") {
        return {
          json: {
            ...DC_ISSUE,
            fields: {
              ...DC_ISSUE.fields,
              customfield_10010: "Демо-продукт",
            },
          },
        };
      }
      return undefined;
    });
    const provider = dcProviderFor(fetcher, {
      fieldAliases: { product: "customfield_10010" },
    });
    const issue = (await provider.execute(
      { credential: dcCredentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123", include: ["custom_fields"] },
    )) as Record<string, unknown>;
    expect(issue["customFields"]).toEqual({ Продукт: "Демо-продукт" });
  });
});
