import { IntegrationError } from "../../src/errors.js";
import { jqlDateValue } from "../../src/providers/jira/jql.js";
import { credentialFor, providerFor, stub } from "./shared.js";

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

  it("resolves a custom field's alias into the instance id it names", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { issues: [], isLast: true },
    }));
    const provider = providerFor(fetcher, {
      fieldAliases: { product: "customfield_10010" },
    });
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        projectKeys: ["PROJ"],
        customFields: [{ field: "product", value: "Dispenser" }],
      },
    );
    const jql = calls[0]?.url.searchParams.get("jql") ?? "";
    expect(jql).toContain('customfield_10010 = "Dispenser"');
    // The alias itself never reaches Jira.
    expect(jql).not.toContain("product");

    // An id is passed through untouched, alias or no alias.
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.search",
      {
        projectKeys: ["PROJ"],
        customFields: [{ field: "customfield_20000", empty: true }],
      },
    );
    expect(calls[1]?.url.searchParams.get("jql")).toContain(
      "customfield_20000 IS EMPTY",
    );
  });

  it("refuses a field name this deployment did not map, and names the ones it did", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { issues: [], isLast: true },
    }));
    const mapped = providerFor(fetcher, {
      fieldAliases: { product: "customfield_10010" },
    });
    const refused = await mapped
      .execute({ credential: credentialFor(mapped) }, "issues.search", {
        projectKeys: ["PROJ"],
        customFields: [{ field: "team", value: "platform" }],
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(IntegrationError);
    expect((refused as IntegrationError).code).toBe("InvalidRequest");
    expect((refused as IntegrationError).message).toContain("product");
    expect(calls).toEqual([]);

    // With no aliases at all the refusal says so instead of listing nothing.
    const bare = providerFor(fetcher);
    const none = await bare
      .execute({ credential: credentialFor(bare) }, "issues.search", {
        projectKeys: ["PROJ"],
        customFields: [{ field: "Продукт", value: "Dispenser" }],
      })
      .catch((error: unknown) => error);
    expect(none).toBeInstanceOf(IntegrationError);
    expect((none as IntegrationError).code).toBe("InvalidRequest");
    expect((none as IntegrationError).message).toContain(
      "configured no aliases",
    );
    expect(calls).toEqual([]);
  });

  it("publishes the deployment's aliases with the field catalog", async () => {
    const { fetcher } = stub(() => ({
      json: [{ id: "customfield_10010", name: "Product", custom: true }],
    }));
    const mapped = providerFor(fetcher, {
      fieldAliases: { product: "customfield_10010" },
    });
    const answer = (await mapped.execute(
      { credential: credentialFor(mapped) },
      "fields.list",
      {},
    )) as Record<string, unknown>;
    expect(answer["aliases"]).toEqual({ product: "customfield_10010" });

    const bare = providerFor(fetcher);
    const plain = (await bare.execute(
      { credential: credentialFor(bare) },
      "fields.list",
      {},
    )) as Record<string, unknown>;
    expect(plain["aliases"]).toBeUndefined();
    expect(plain["returned"]).toBe(1);
  });
});
