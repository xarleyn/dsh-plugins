import { resolveConfig } from "../src/config.js";
import { IntegrationError } from "../src/errors.js";
import { adfToText, bodyText } from "../src/providers/jira/adf.js";
import {
  resolveJiraConfig,
  type JiraFlags,
} from "../src/providers/jira/config.js";
import { JiraProvider } from "../src/providers/jira/index.js";
import {
  buildJql,
  jqlDateValue,
  jqlLiteral,
  needsUserLookup,
  textClauses,
} from "../src/providers/jira/jql.js";
import {
  customFieldValue,
  issueFields,
  requestedIncludes,
} from "../src/providers/jira/operations.js";

const TOKEN = "ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789_-";
const EMAIL = "alice@example.com";

const COMPANY = {
  id: "company",
  label: "company.atlassian.net",
  baseUrl: "https://company.atlassian.net",
};
const SANDBOX = {
  id: "sandbox",
  label: "Sandbox",
  baseUrl: "https://sandbox.atlassian.net",
};
const SITES = [COMPANY, SANDBOX];

interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
}

interface StubCall {
  readonly url: URL;
  readonly init: RequestInit;
}

function stub(handler: (url: URL) => StubResult) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    const result = handler(url);
    const headers = new Headers(result.headers ?? {});
    const status = result.status ?? 200;
    if (result.json !== undefined) {
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(result.json), { status, headers });
    }
    headers.set("content-type", headers.get("content-type") ?? "text/plain");
    return new Response(result.text ?? "", { status, headers });
  };
  return { calls, fetcher };
}

function config(jira: Partial<JiraFlags> = {}) {
  return resolveConfig({ jira: { sites: SITES, ...jira } });
}

function providerFor(
  fetcher: typeof fetch,
  jira: Partial<JiraFlags> = {},
): JiraProvider {
  return new JiraProvider(config(jira), fetcher);
}

/** Credential plaintext as `parseCredential` stores it. */
function credentialFor(
  provider: JiraProvider,
  siteId = COMPANY.id,
  email = EMAIL,
): string {
  return provider.parseCredential(TOKEN, { siteId, email }).credential;
}

const MYSELF = {
  accountId: "5b10ac8d82e05b22cc7d4ef5",
  displayName: "Alice Example",
  emailAddress: EMAIL,
  accountType: "atlassian",
  active: true,
  timeZone: "Europe/Moscow",
};

/** The answer every validate call needs: identity plus the Cloud check. */
function cloud(extra: (url: URL) => StubResult | undefined) {
  return stub((url) => {
    const decided = extra(url);
    if (decided !== undefined) return decided;
    if (url.pathname.endsWith("/myself")) return { json: MYSELF };
    if (url.pathname.endsWith("/serverInfo")) {
      return { json: { deploymentType: "Cloud", version: "1001.0.0" } };
    }
    return { status: 404, json: { errorMessages: ["not found"] } };
  });
}

describe("jira site configuration", () => {
  it("canonicalizes configured sites and rejects unsafe ones", () => {
    const flags = resolveJiraConfig({
      sites: [
        { id: "company", label: "", baseUrl: "https://company.atlassian.net/" },
        { id: "lab", label: "Lab", baseUrl: "https://jira.example.com/jira/" },
      ],
    });
    expect(flags.sites).toEqual([
      {
        id: "company",
        label: "company.atlassian.net",
        baseUrl: "https://company.atlassian.net",
      },
      {
        id: "lab",
        label: "Lab",
        baseUrl: "https://jira.example.com/jira",
      },
    ]);
    expect(flags.enabled).toBe(true);
    expect(flags.defaultSearchLimit).toBe(20);
    expect(flags.maxSearchLimit).toBe(100);

    for (const bad of [
      { id: "plain", label: "x", baseUrl: "http://company.atlassian.net" },
      { id: "creds", label: "x", baseUrl: "https://user:pw@jira.example" },
      { id: "query", label: "x", baseUrl: "https://jira.example?x=1" },
      { id: "Bad Id", label: "x", baseUrl: "https://jira.example" },
      { id: "protocol", label: "x", baseUrl: "ftp://jira.example" },
      { id: "no-url", label: "x", baseUrl: "jira.example" },
    ]) {
      expect(() => resolveJiraConfig({ sites: [bad] })).toThrow(
        /jira integration config/u,
      );
    }
    expect(() =>
      resolveJiraConfig({
        sites: [
          { id: "same", label: "a", baseUrl: "https://a.example" },
          { id: "same", label: "b", baseUrl: "https://b.example" },
        ],
      }),
    ).toThrow(/duplicate/u);
  });

  it("caps the search page at the deployment ceiling", () => {
    // A default above the ceiling is folded down instead of becoming a hole.
    expect(
      resolveJiraConfig({ defaultSearchLimit: 80, maxSearchLimit: 50 })
        .defaultSearchLimit,
    ).toBe(50);
    expect(resolveJiraConfig({ maxSearchLimit: 500 }).maxSearchLimit).toBe(100);
  });
});

describe("jira connect form", () => {
  it("accepts an API token only as a token, never as a pasted URL", () => {
    const provider = providerFor(stub(() => ({})).fetcher);
    for (const bad of [
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "short",
      "alice@example.com:ATATT3xFfGF0abcdefghijklmnop",
      `${TOKEN}\nmore`,
    ]) {
      expect(() =>
        provider.parseCredential(bad, { siteId: "company", email: EMAIL }),
      ).toThrow(/Atlassian API token/u);
    }
    // Surrounding whitespace is a paste artifact, not part of the token.
    expect(
      provider.parseCredential(` ${TOKEN} `, {
        siteId: COMPANY.id,
        email: EMAIL,
      }).credential,
    ).toContain(TOKEN);
  });

  it("requires the e-mail the token is spent as", () => {
    const provider = providerFor(stub(() => ({})).fetcher);
    for (const email of ["", "alice", "alice@", "alice example@x.com"]) {
      expect(() =>
        provider.parseCredential(TOKEN, { siteId: COMPANY.id, email }),
      ).toThrow(/e-mail of the Atlassian account/u);
    }
  });

  it("binds the token to a configured site and refuses unknown ones", () => {
    const { fetcher } = stub(() => ({}));
    const many = providerFor(fetcher);
    expect(() => many.parseCredential(TOKEN, { email: EMAIL })).toThrow(
      /Choose a Jira site/u,
    );

    const single = providerFor(fetcher, { sites: [COMPANY] });
    const parsed = single.parseCredential(TOKEN, { email: EMAIL });
    expect(parsed.portal).toBe("https://company.atlassian.net");
    expect(JSON.parse(parsed.credential)).toEqual({
      siteId: "company",
      email: EMAIL,
      token: TOKEN,
    });

    expect(() =>
      many.parseCredential(TOKEN, { siteId: "nope", email: EMAIL }),
    ).toThrow(/Unknown Jira site/u);
    const none = providerFor(fetcher, { sites: [] });
    expect(() => none.parseCredential(TOKEN, { email: EMAIL })).toThrow(
      /No Jira site is configured/u,
    );
  });
});

describe("jira connection validation", () => {
  it("reports the account behind the token and the site it lives on", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    const validation = await provider.validate({
      credential: credentialFor(provider),
    });
    expect(validation.tenantId).toBe("https://company.atlassian.net");
    expect(validation.externalUserId).toBe(MYSELF.accountId);
    expect(validation.displayName).toBe(`Alice Example (${EMAIL})`);
    expect(validation.capabilities).toEqual([
      "identity.read",
      "issues.read",
      "comments.read",
      "attachments.read",
      "transitions.read",
      "projects.read",
      "fields.read",
    ]);
  });

  it("narrows the offered capabilities to the deployment switches", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher, {
      transitionsRead: false,
      fieldsRead: false,
      attachmentsRead: false,
    });
    const validation = await provider.validate({
      credential: credentialFor(provider),
    });
    expect(validation.capabilities).toEqual([
      "identity.read",
      "issues.read",
      "comments.read",
      "projects.read",
    ]);
  });

  it("refuses a Data Center deployment instead of pretending it is Cloud", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/myself")
        ? { json: MYSELF }
        : { json: { deploymentType: "Data Center", version: "9.12" } },
    );
    const provider = providerFor(fetcher);
    await expect(
      provider.validate({ credential: credentialFor(provider) }),
    ).rejects.toMatchObject({ code: "InvalidCredential" });
  });

  it("keeps the identity call as the answer when serverInfo is unavailable", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/myself")
        ? { json: MYSELF }
        : { status: 404, json: { errorMessages: ["no endpoint"] } },
    );
    const provider = providerFor(fetcher);
    await expect(
      provider.validate({ credential: credentialFor(provider) }),
    ).resolves.toMatchObject({ externalUserId: MYSELF.accountId });
  });

  it("fails closed when the site is no longer configured, without dialling", async () => {
    const { fetcher, calls } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    const credential = credentialFor(provider, SANDBOX.id);
    const narrowed = new JiraProvider(config({ sites: [COMPANY] }), fetcher);
    await expect(narrowed.validate({ credential })).rejects.toMatchObject({
      code: "CredentialRevoked",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a stored credential that is not a Jira credential", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    for (const raw of [
      "not json",
      JSON.stringify({ siteId: "company", email: EMAIL }),
      JSON.stringify({ siteId: "", email: EMAIL, token: TOKEN }),
    ]) {
      await expect(
        provider.validate({ credential: raw }),
      ).rejects.toMatchObject({ code: "CredentialRevoked" });
    }
  });
});

describe("jql builder", () => {
  it("quotes and escapes every value it is given", () => {
    expect(jqlLiteral('a" OR project = SECRET', "query")).toBe(
      '"a\\" OR project = SECRET"',
    );
    expect(jqlLiteral("back\\slash", "query")).toBe('"back\\\\slash"');
    for (const bad of ["line\nbreak", "tab\there", ""]) {
      expect(() => jqlLiteral(bad, "query")).toThrow(/query is invalid/u);
    }
  });

  it("turns a text fragment into terms or a phrase, never into a clause", () => {
    expect(textClauses("payment timeout", "phrase")).toEqual([
      'text ~ "\\"payment timeout\\""',
    ]);
    expect(textClauses("payment timeout", undefined)).toEqual([
      'text ~ "payment"',
      'text ~ "timeout"',
    ]);
    expect(textClauses("timeout", undefined)).toEqual(['text ~ "timeout"']);
    expect(
      buildJql({ query: 'done" OR project = SECRET', match: "phrase" }),
    ).toBe('text ~ "\\"done\\" OR project = SECRET\\"" ORDER BY updated DESC');
    // Every word is its own clause, so an OR smuggled into a term stays inside
    // the string literal it was written in.
    expect(buildJql({ query: "x OR project = SECRET" })).toBe(
      'text ~ "x" AND text ~ "OR" AND text ~ "project" AND text ~ "=" AND text ~ "SECRET" ORDER BY updated DESC',
    );
  });

  it("builds the filter set the specification describes", () => {
    expect(
      buildJql({
        projectKeys: ["proj", "platform"],
        statuses: ["In Progress"],
        assignee: "me",
        reporter: "5b10ac8d82e05b22cc7d4ef5",
        labels: ["regression", "qa"],
        updatedAfter: "2026-09-01",
        createdAfter: "2026-09-01T10:30:00Z",
      }),
    ).toBe(
      'project in ("PROJ", "PLATFORM") AND status in ("In Progress") AND labels = "regression" AND labels = "qa" AND assignee = currentUser() AND reporter = "5b10ac8d82e05b22cc7d4ef5" AND created >= "2026-09-01 10:30" AND updated >= "2026-09-01" ORDER BY updated DESC',
    );
  });

  it("covers the filters a corporate Jira search is asked for", () => {
    expect(
      buildJql({
        issueTypes: ["Ошибка"],
        statusCategories: ["Done"],
        priorities: ["Критичный"],
        resolutions: ["Fixed"],
        components: ["Public API"],
        fixVersions: ["3.8"],
        affectedVersions: ["3.7"],
        statuses: ["Закрыт"],
      }),
    ).toBe(
      'issuetype in ("Ошибка") AND status in ("Закрыт") AND statusCategory = "Done" AND priority in ("Критичный") AND resolution in ("Fixed") AND component in ("Public API") AND fixVersion in ("3.8") AND affectedVersion in ("3.7") ORDER BY updated DESC',
    );
    // The category is a Jira constant, whatever case the caller sends.
    expect(buildJql({ statusCategories: ["done"] })).toContain(
      'statusCategory = "Done"',
    );
    expect(() => buildJql({ statusCategories: ["Closed"] })).toThrow(
      /statusCategories accepts To Do, In Progress, Done/u,
    );
  });

  it("expresses an empty version field and refuses a contradiction", () => {
    expect(buildJql({ fixVersionEmpty: true })).toBe(
      "fixVersion IS EMPTY ORDER BY updated DESC",
    );
    expect(buildJql({ fixVersionEmpty: false })).toBe(
      "fixVersion IS NOT EMPTY ORDER BY updated DESC",
    );
    expect(buildJql({ affectedVersionEmpty: true })).toBe(
      "affectedVersion IS EMPTY ORDER BY updated DESC",
    );
    expect(() =>
      buildJql({ fixVersions: ["3.8"], fixVersionEmpty: true }),
    ).toThrow(/contradict each other/u);
  });

  it("filters a custom field by the id the field catalog reported", () => {
    expect(
      buildJql({
        customFields: [
          { field: "customfield_10020", value: "Release 3.8" },
          { field: "customfield_10010", value: "high", match: "contains" },
          { field: "customfield_20000", empty: false },
        ],
      }),
    ).toBe(
      'customfield_10020 = "Release 3.8" AND customfield_10010 ~ "high" AND customfield_20000 IS NOT EMPTY ORDER BY updated DESC',
    );
    // A field name is refused: an instance can carry several fields with one
    // display name, and picking one of them would be a guess.
    expect(() => buildJql({ customFields: [{ field: "Product" }] })).toThrow(
      /customFields.field is invalid/u,
    );
    expect(
      buildJql({
        customFields: [
          { field: "customfield_10020", value: 'x" OR project = SECRET' },
        ],
      }),
    ).toBe(
      'customfield_10020 = "x\\" OR project = SECRET" ORDER BY updated DESC',
    );
    expect(() =>
      buildJql({
        customFields: Array.from({ length: 6 }, () => ({
          field: "customfield_1",
          value: "x",
        })),
      }),
    ).toThrow(/customFields is invalid/u);
  });

  it("takes Jira's relative date tokens as well as absolute dates", () => {
    expect(buildJql({ createdAfter: "-3w" })).toBe(
      "created >= -3w ORDER BY updated DESC",
    );
    expect(buildJql({ updatedBefore: "-4h" })).toBe(
      "updated <= -4h ORDER BY updated DESC",
    );
    expect(buildJql({ createdAfter: "-3w", createdBefore: "-1w" })).toBe(
      "created >= -3w AND created <= -1w ORDER BY updated DESC",
    );
    expect(buildJql({ updatedBefore: "2026-08-31" })).toBe(
      'updated <= "2026-08-31" ORDER BY updated DESC',
    );
    expect(() => buildJql({ updatedBefore: "yesterday" })).toThrow(
      /updatedBefore is invalid/u,
    );
  });

  it("refuses a search that would ask for the whole site", () => {
    expect(() => buildJql({})).toThrow(/at least one filter/u);
  });

  it("refuses a name where Jira needs an account id", () => {
    expect(() => buildJql({ assignee: "Иван Иванов" })).toThrow(
      /must be "me" or the accountId/u,
    );
    expect(() => buildJql({ projectKeys: ["not a key"] })).toThrow(
      /projectKeys is invalid/u,
    );
    expect(() => buildJql({ updatedAfter: "yesterday" })).toThrow(
      /updatedAfter is invalid/u,
    );
    expect(() => buildJql({ labels: ["x".repeat(101)] })).toThrow(
      /labels is invalid/u,
    );
  });
});

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

describe("jira project, fields and transitions", () => {
  it("answers one project with its permalink", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        id: "10",
        key: "PROJ",
        name: "Medical",
        projectTypeKey: "software",
        simplified: false,
        isPrivate: true,
        lead: { accountId: "5b10ac8d82e05b22cc7d4ef5", displayName: "Alice" },
        description: "Clinical workflow",
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "projects.get",
      { projectKey: "proj" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/project/PROJ");
    expect(answer).toMatchObject({
      key: "PROJ",
      name: "Medical",
      isPrivate: true,
      url: "https://company.atlassian.net/browse/PROJ",
      description: "Clinical workflow",
    });
  });

  it("lists the fields of the site as the account may see them", async () => {
    const { fetcher, calls } = stub(() => ({
      json: [
        {
          id: "summary",
          name: "Summary",
          custom: false,
          schema: { type: "string" },
          clauseNames: ["summary"],
          navigable: true,
          searchable: true,
          orderable: true,
        },
        {
          id: "customfield_10010",
          name: "Notes",
          custom: true,
          schema: { type: "array", items: "doc" },
          clauseNames: ["Notes", "cf[10010]"],
        },
      ],
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "fields.list",
      {},
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/field");
    expect(answer["returned"]).toBe(2);
    expect((answer["items"] as unknown[])[1]).toEqual({
      id: "customfield_10010",
      name: "Notes",
      custom: true,
      type: "array",
      items: "doc",
      clauseNames: ["Notes", "cf[10010]"],
    });
  });

  it("names the issue a transitions answer belongs to and never transitions it", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        expand: "transitions",
        transitions: [
          {
            id: "31",
            name: "Done",
            to: { id: "10001", name: "Done" },
            hasScreen: true,
            isAvailable: true,
            isGlobal: false,
            isInitial: false,
            isConditional: false,
            fields: {
              resolution: { required: true, name: "Resolution" },
              summary: { required: false, name: "Summary" },
            },
          },
        ],
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.transitions",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe(
      "/rest/api/3/issue/PROJ-123/transitions",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(answer["key"]).toBe("PROJ-123");
    expect((answer["items"] as unknown[])[0]).toMatchObject({
      id: "31",
      name: "Done",
      to: { id: "10001", name: "Done" },
      requiredFields: ["Resolution"],
    });
  });

  it("lists attachments from the issue itself", async () => {
    const { fetcher, calls } = stub(() => ({
      json: {
        key: "PROJ-123",
        fields: {
          attachment: [
            {
              id: "20001",
              filename: "trace.txt",
              mimeType: "text/plain",
              size: 10,
            },
          ],
        },
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.attachments",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.searchParams.get("fields")).toBe("attachment");
    expect(answer["key"]).toBe("PROJ-123");
    expect(answer["returned"]).toBe(1);
  });
});

describe("jira people filters", () => {
  const DIRECTORY = [
    {
      accountId: "5b10ac8d82e05b22cc7d4ef5",
      displayName: "Иван Иванов",
      active: true,
    },
    {
      accountId: "5b10ac8d82e05b22cc7d4ef6",
      displayName: "Пётр Петров",
      active: true,
    },
  ];

  /** A search host whose directory answers with `users`. */
  function search(users: unknown = DIRECTORY) {
    return stub((url) => {
      if (url.pathname.endsWith("/user/search")) {
        return { json: users };
      }
      if (url.pathname.endsWith("/search/jql")) {
        return { json: { issues: [], isLast: true } };
      }
      return { status: 404, json: { errorMessages: ["no"] } };
    });
  }

  function jqlOf(call: StubCall | undefined): string {
    return call?.url.searchParams.get("jql") ?? "";
  }

  it("turns a name into the account id Jira filters on", async () => {
    const { fetcher, calls } = search([DIRECTORY[0]]);
    const provider = providerFor(fetcher);
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        projectKeys: ["PROJ"],
        assignee: "Иванов",
      },
    );
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/user/search");
    expect(calls[0]?.url.searchParams.get("query")).toBe("Иванов");
    expect(jqlOf(calls[1])).toContain('assignee = "5b10ac8d82e05b22cc7d4ef5"');
    // The directory answer stays out of the query result.
    expect(jqlOf(calls[1])).not.toContain("Иван Иванов");
  });

  it("costs no directory call for `me` or for an account id", async () => {
    const { fetcher, calls } = search();
    const provider = providerFor(fetcher);
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        assignee: "me",
        reporter: "5b10ac8d82e05b22cc7d4ef6",
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/rest/api/3/search/jql");
    expect(jqlOf(calls[0])).toContain("assignee = currentUser()");
    expect(jqlOf(calls[0])).toContain('reporter = "5b10ac8d82e05b22cc7d4ef6"');
    expect(needsUserLookup("me")).toBe(false);
    expect(needsUserLookup("5b10ac8d82e05b22cc7d4ef6")).toBe(false);
    expect(needsUserLookup("Иванов")).toBe(true);
  });

  it("refuses a name nobody matches instead of answering an empty page", async () => {
    const { fetcher, calls } = search([]);
    const provider = providerFor(fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "issues.search",
        {
          assignee: "Никто",
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(1);
  });

  it("refuses an ambiguous name and names the candidates", async () => {
    const { fetcher } = search(DIRECTORY);
    const provider = providerFor(fetcher);
    const cause = await provider
      .execute({ credential: credentialFor(provider) }, "issues.search", {
        assignee: "Петров",
      })
      .catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(IntegrationError);
    const error = cause as IntegrationError;
    expect(error.code).toBe("InvalidRequest");
    expect(error.message).toContain("2 Jira users");
    expect(error.message).toContain("Иван Иванов");
  });

  it("keeps a refused directory a domain error, not a crash", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/user/search")
        ? { status: 403, json: { errorMessages: ["denied"] } }
        : { json: { issues: [], isLast: true } },
    );
    const provider = providerFor(fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "issues.search",
        {
          assignee: "Иванов",
        },
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
  });
});

describe("jira issue history and lists", () => {
  const ISSUE = {
    id: "10001",
    key: "PROJ-123",
    fields: {
      summary: "Payment timeout",
      components: [{ id: "1", name: "PROJ. Техдолг" }],
      fixVersions: [{ id: "2", name: "3.8", released: false }],
      versions: [{ id: "3", name: "3.7" }],
    },
    changelog: {
      total: 3,
      histories: [
        {
          created: "2026-09-02T09:00:00.000+0300",
          author: {
            accountId: "5b10ac8d82e05b22cc7d4ef5",
            displayName: "Alice",
          },
          items: [
            {
              field: "status",
              fieldId: "status",
              fromString: "Open",
              toString: "In Progress",
            },
            {
              field: "Fix Version",
              fieldId: "fixVersions",
              fromString: null,
              toString: "3.8",
            },
          ],
        },
      ],
    },
  };

  function issue() {
    return stub((url) =>
      url.pathname.includes("/issue/")
        ? { json: ISSUE }
        : { status: 404, json: { errorMessages: ["no"] } },
    );
  }

  it("answers the compact card with components and versions", async () => {
    const { fetcher } = stub(() => ({
      json: {
        issues: [ISSUE],
        isLast: true,
      },
    }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      { projectKeys: ["PROJ"] },
    )) as Record<string, unknown>;
    const item = (answer["items"] as Record<string, unknown>[])[0];
    expect(item?.["components"]).toEqual(["PROJ. Техдолг"]);
    expect(item?.["fixVersions"]).toEqual(["3.8"]);
  });

  it("adds the change history only when it was asked for", async () => {
    const { fetcher, calls } = issue();
    const provider = providerFor(fetcher);
    const plain = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123" },
    )) as Record<string, unknown>;
    expect(plain["changelog"]).toBeUndefined();
    expect(calls[0]?.url.searchParams.get("expand")).toBeNull();

    const withHistory = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123", include: ["changelog_summary"] },
    )) as Record<string, unknown>;
    expect(calls[1]?.url.searchParams.get("expand")).toBe("changelog");
    // Jira counts three change groups but sent one: the answer says so instead
    // of pretending the history ends there.
    expect(withHistory["changelog"]).toEqual({
      total: 3,
      groupsReturned: 1,
      returned: 2,
      groupsTruncated: true,
      entries: [
        {
          createdAt: "2026-09-02T09:00:00.000+0300",
          author: {
            accountId: "5b10ac8d82e05b22cc7d4ef5",
            displayName: "Alice",
          },
          field: "status",
          fieldId: "status",
          from: "Open",
          to: "In Progress",
        },
        {
          createdAt: "2026-09-02T09:00:00.000+0300",
          author: {
            accountId: "5b10ac8d82e05b22cc7d4ef5",
            displayName: "Alice",
          },
          field: "Fix Version",
          fieldId: "fixVersions",
          to: "3.8",
        },
      ],
    });
    // The full card also carries the versions as a list, not just as names.
    expect(withHistory["affectedVersions"]).toEqual(["3.7"]);
    expect(withHistory["fixVersions"]).toEqual(["3.8"]);
  });

  it("bounds a long history and says that it did", async () => {
    const long = {
      ...ISSUE,
      changelog: {
        total: 40,
        histories: Array.from({ length: 40 }, (_, index) => ({
          created: `2026-09-${String(index + 1).padStart(2, "0")}T09:00:00.000+0300`,
          author: {
            accountId: "5b10ac8d82e05b22cc7d4ef5",
            displayName: "Alice",
          },
          items: [
            { field: "status", fieldId: "status", toString: `S${index}` },
          ],
        })),
      },
    };
    const { fetcher } = stub(() => ({ json: long }));
    const provider = providerFor(fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123", include: ["changelog_summary"] },
    )) as Record<string, unknown>;
    const changelog = answer["changelog"] as Record<string, unknown>;
    expect(changelog["returned"]).toBe(20);
    expect(changelog["total"]).toBe(40);
    expect(changelog["truncated"]).toBe(true);
  });

  it("takes a relative window Jira understands", () => {
    expect(jqlDateValue("-3w", "createdAfter")).toBe("-3w");
    expect(jqlDateValue("2026-08-31", "createdAfter")).toBe('"2026-08-31"');
    expect(jqlDateValue("2026-08-31T12:00:00Z", "createdAfter")).toBe(
      '"2026-08-31 12:00"',
    );
  });
});

describe("jira failure model", () => {
  function failing(status: number, headers: Record<string, string> = {}) {
    return stub(() => ({ status, headers, json: { errorMessages: ["nope"] } }));
  }

  async function call(fetcher: typeof fetch) {
    const provider = providerFor(fetcher);
    return provider.execute(
      { credential: credentialFor(provider) },
      "connection.get",
      {},
    );
  }

  it("maps upstream answers onto the domain codes", async () => {
    for (const [status, code] of [
      [401, "CredentialRevoked"],
      [403, "ProviderPermissionDenied"],
      [404, "ResourceNotFound"],
      [400, "InvalidRequest"],
      [500, "ProviderUnavailable"],
    ] as const) {
      await expect(call(failing(status).fetcher)).rejects.toMatchObject({
        code,
      });
    }
  });

  it("honours Retry-After once and then gives up", async () => {
    const { fetcher, calls } = failing(429, { "retry-after": "0" });
    await expect(call(fetcher)).rejects.toMatchObject({ code: "RateLimited" });
    // Two retries by default: the first answer plus two more attempts.
    expect(calls).toHaveLength(3);
  });

  it("never puts the token in the URL and never follows a redirect", async () => {
    const { fetcher, calls } = cloud((url) =>
      url.pathname.includes("/issue/")
        ? { json: { id: "10001", key: "PROJ-123", fields: { summary: "x" } } }
        : undefined,
    );
    const provider = providerFor(fetcher);
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123" },
    );
    const call = calls[0];
    expect(call?.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64")}`,
    });
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.method).toBe("GET");
    expect(call?.url.href).not.toContain(TOKEN);
    expect(call?.url.href).not.toContain(EMAIL);
  });

  it("refuses an answer larger than the deployment allows", async () => {
    const { fetcher } = stub(() => ({
      json: { padding: "x".repeat(4_000) },
    }));
    const provider = new JiraProvider(
      resolveConfig({ maxResponseBytes: 1_024, jira: { sites: SITES } }),
      fetcher,
    );
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
  });

  it("reports a body that is not JSON as an upstream fault", async () => {
    const { fetcher } = stub(() => ({ text: "<html>login</html>" }));
    await expect(call(fetcher)).rejects.toMatchObject({
      code: "ProviderUnavailable",
    });
  });

  it("refuses an operation that is not in the catalog", async () => {
    const { fetcher, calls } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    for (const operation of [
      "issues.create",
      "issues.transition",
      "rest.call",
      "raw",
    ]) {
      await expect(
        provider.execute(
          { credential: credentialFor(provider) },
          operation,
          {},
        ),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toEqual([]);
  });
});

describe("atlassian document format", () => {
  it("renders the structure the model needs to read", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Steps" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "run " },
            { type: "text", text: "make test", marks: [{ type: "code" }] },
            {
              type: "text",
              text: " then see ",
            },
            {
              type: "text",
              text: "the runbook",
              marks: [
                { type: "link", attrs: { href: "https://wiki.example/run" } },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { order: 3 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "second" }],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "bash" },
          content: [{ type: "text", text: "npm run build" }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "1" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "2" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "5b10", text: "Alice" } },
            { type: "text", text: " " },
            { type: "emoji", attrs: { shortName: "smile" } },
            { type: "text", text: " status " },
            { type: "status", attrs: { text: "BLOCKED" } },
          ],
        },
      ],
    };
    expect(adfToText(doc, 5_000).text).toBe(
      [
        "## Steps",
        "run `make test` then see [the runbook](https://wiki.example/run)",
        "3. first",
        "4. second",
        "```bash",
        "npm run build",
        "```",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "@Alice :smile: status `BLOCKED`",
      ].join("\n"),
    );
  });

  it("marks media and cards instead of fetching them", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            { type: "media", attrs: { id: "abc", alt: "screenshot.png" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "inlineCard", attrs: { url: "https://wiki.example/page" } },
          ],
        },
      ],
    };
    expect(adfToText(doc, 5_000).text).toBe(
      "[media: screenshot.png]\n<https://wiki.example/page>",
    );
  });

  it("bounds the text it hands over and says when it cut", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(100) }],
        },
      ],
    };
    expect(adfToText(doc, 10)).toEqual({
      text: "x".repeat(10),
      truncated: true,
    });
    // A plain body takes the same budget; a value that is neither is empty.
    expect(bodyText("y".repeat(50), 10)).toEqual({
      text: "y".repeat(10),
      truncated: true,
    });
    expect(bodyText(42, 10)).toEqual({ text: "", truncated: false });
  });

  it("reduces custom field values to something readable", () => {
    expect(customFieldValue("plain", 10)).toBe("plain");
    expect(customFieldValue(["a", "b"], 10)).toEqual(["a", "b"]);
    expect(customFieldValue({ value: "Gold", id: "5" }, 10)).toEqual({
      id: "5",
      value: "Gold",
    });
    expect(customFieldValue({ unknown: { nested: true } }, 100)).toBe(
      '{"unknown":{"nested":true}}',
    );
    expect(customFieldValue(null, 10)).toBeNull();
  });
});

describe("provider boundary of this suite", () => {
  it("keeps the token out of every tool result", async () => {
    const { fetcher } = cloud(() => ({ json: MYSELF }));
    const provider = providerFor(fetcher);
    const answer = await provider.execute(
      { credential: credentialFor(provider) },
      "connection.get",
      {},
    );
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(JSON.stringify(answer)).not.toContain("Basic ");
  });

  it("fails closed when the stored credential names another site", async () => {
    const { fetcher, calls } = stub(() => ({ json: MYSELF }));
    const provider = providerFor(fetcher);
    const credential = credentialFor(provider, SANDBOX.id);
    const narrowed = new JiraProvider(config({ sites: [COMPANY] }), fetcher);
    await expect(
      narrowed.execute({ credential }, "connection.get", {}),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
    expect(calls).toEqual([]);
  });

  it("turns an unsupported operation into a safe domain error", async () => {
    const { fetcher } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    const error = await provider
      .execute({ credential: credentialFor(provider) }, "issues.create", {})
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).message).not.toContain(TOKEN);
  });
});
