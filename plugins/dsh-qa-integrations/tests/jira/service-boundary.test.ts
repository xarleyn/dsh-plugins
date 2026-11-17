import { resolveConfig } from "../../src/config.js";
import { JIRA_OPERATIONS } from "../../src/providers/jira/catalog.js";
import {
  JiraProvider,
  projectAllowed,
} from "../../src/providers/jira/index.js";
import { SANDBOX } from "./shared.js";
import {
  BOUNDARY,
  COMPANY,
  config,
  credential,
  serviceContext,
  stub,
} from "./service.helpers.js";

describe("Jira boundary matching", () => {
  it("refuses an unavailable search project with the connection's allowed keys", async () => {
    const { fetcher, calls } = stub(() => ({ json: { issues: [] } }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        {
          credential: plaintext,
          ...serviceContext({ projects: ["PROJ", "DEMO"] }),
        },
        "issues.search",
        { query: "export", projectKeys: ["PROJ", "UNKNOWN"] },
      ),
    ).rejects.toMatchObject({
      code: "ServiceResourceNotAllowed",
      message: expect.stringContaining("Allowed project keys: DEMO, PROJ"),
    });
    expect(calls).toHaveLength(0);
  });

  it("does not reveal projects excluded from the current connection's selection", async () => {
    const { fetcher, calls } = stub(() => ({ json: { issues: [] } }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext({ projects: ["proj"] }) },
        "issues.search",
        { query: "export", projectKeys: ["DEMO"] },
      ),
    ).rejects.toMatchObject({
      code: "ServiceResourceNotAllowed",
      message: expect.stringContaining("Allowed project keys: PROJ"),
    });
    expect(calls).toHaveLength(0);
  });

  it("keeps case-insensitive permitted search keys and personal searches working", async () => {
    const { fetcher, calls } = stub(() => ({ json: { issues: [] } }));
    const { provider, plaintext } = credential(fetcher);
    await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "issues.search",
      { query: "export", projectKeys: ["proj"] },
    );
    await provider.execute({ credential: plaintext }, "issues.search", {
      query: "export",
      projectKeys: ["DEMO"],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get("jql")).toContain(
      'project in ("PROJ")',
    );
    expect(calls[1]?.url.searchParams.get("jql")).toContain(
      'project in ("DEMO")',
    );
  });

  it("retains key-to-id matching for a boundary configured with numeric project ids", async () => {
    const { fetcher } = stub(() => ({
      json: {
        issues: [
          {
            key: "DEMO-123",
            fields: { project: { key: "DEMO", id: "10001" }, security: null },
          },
        ],
      },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext({ projects: ["10001"] }) },
        "issues.search",
        { query: "export", projectKeys: ["DEMO"] },
      ),
    ).resolves.toMatchObject({ items: [{ key: "DEMO-123" }] });
  });

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
    expect(projectAllowed(BOUNDARY, "PROJ-123")).toBe(false);
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
        : { json: { key: "PROJ-456", fields: { summary: "x" } } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        {
          credential: plaintext,
          ...serviceContext({ projects: ["proj"] }),
        },
        "issues.get",
        { issueKey: "PROJ-456" },
      ),
    ).resolves.toMatchObject({ key: "PROJ-456" });
    expect(calls).toHaveLength(2);
  });
});
