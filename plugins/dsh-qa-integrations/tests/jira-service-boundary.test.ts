import { resolveConfig } from "../src/config.js";
import { JIRA_OPERATIONS } from "../src/providers/jira/catalog.js";
import { JiraProvider, projectAllowed } from "../src/providers/jira/index.js";
import { SANDBOX } from "./jira/shared.js";
import {
  BOUNDARY,
  COMPANY,
  config,
  credential,
  serviceContext,
  stub,
} from "./jira-service.helpers.js";

describe("Jira boundary matching", () => {
  it("covers a listed key in any case and a listed numeric id", () => {
    expect(projectAllowed(BOUNDARY, "PROJ")).toBe(true);
    expect(projectAllowed(BOUNDARY, "proj")).toBe(true);
    expect(projectAllowed(BOUNDARY, "10001")).toBe(true);
  });

  it("refuses a stranger, a prefix lookalike and an issue key", () => {
    expect(projectAllowed(BOUNDARY, "OTHER")).toBe(false);
    expect(projectAllowed(BOUNDARY, "PROJX")).toBe(false);
    // An issue key names a project only up to the dash; as a project
    // reference it matches nothing.
    expect(projectAllowed(BOUNDARY, "PROJ-1")).toBe(false);
    expect(projectAllowed(BOUNDARY, "")).toBe(false);
  });

  it("bounds every project-scoped operation and nothing else", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new JiraProvider(config(), fetcher);
    for (const [operation, definition] of Object.entries(JIRA_OPERATIONS)) {
      const kind = provider.resourceBoundaryKind?.(operation);
      if (definition.security.requiresResourceBoundary) {
        expect(kind, operation).toBe("projects");
      } else {
        expect(kind, operation).toBeUndefined();
      }
    }
  });

  it("names the portal of one configured site, empty id meaning the only one", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new JiraProvider(
      resolveConfig({ jira: { sites: [COMPANY] } }),
      fetcher,
    );
    expect(provider.instancePortal(COMPANY.id)).toBe(COMPANY.baseUrl);
    expect(provider.instancePortal("")).toBe(COMPANY.baseUrl);
    expect(provider.instancePortal("elsewhere")).toBeUndefined();

    const both = new JiraProvider(
      resolveConfig({ jira: { sites: [COMPANY, SANDBOX] } }),
      fetcher,
    );
    expect(both.instancePortal("")).toBeUndefined();
    expect(both.instancePortal(SANDBOX.id)).toBe(SANDBOX.baseUrl);
  });

  it("matches an issue key against a boundary entry in another case", async () => {
    const { fetcher, calls } = stub((url) =>
      url.searchParams.get("fields") === "security"
        ? { json: { fields: { security: null } } }
        : { json: { key: "PROJ-3", fields: { summary: "x" } } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        {
          credential: plaintext,
          ...serviceContext({ projects: ["proj"] }),
        },
        "issues.get",
        { issueKey: "PROJ-3" },
      ),
    ).resolves.toMatchObject({ key: "PROJ-3" });
    expect(calls).toHaveLength(2);
  });
});
