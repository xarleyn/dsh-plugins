import { IntegrationError } from "../../src/errors.js";
import { needsUserLookup } from "../../src/providers/jira/jql.js";
import { type StubCall, credentialFor, providerFor, stub } from "./shared.js";

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
