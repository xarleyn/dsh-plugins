import { readFileSync } from "node:fs";
import { resolveConfig } from "../src/config.js";
import {
  JIRA_CAPABILITIES,
  JIRA_OPERATIONS,
  JIRA_READ_PATHS,
  enabledCapabilities,
} from "../src/providers/jira/catalog.js";
import {
  ISSUE_INCLUDES,
  JIRA_HANDLERS,
  JIRA_PROJECTIONS,
} from "../src/providers/jira/operations.js";
import { JIRA_TOOL_NAMES } from "../src/providers/jira/tools.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";

const TOOLS_SOURCE = readFileSync(
  new URL("../src/providers/jira/tools.ts", import.meta.url),
  "utf8",
);
const CATALOG_SOURCE = readFileSync(
  new URL("../src/providers/jira/catalog.ts", import.meta.url),
  "utf8",
);
const TRANSPORT_SOURCE = readFileSync(
  new URL("../src/providers/jira/transport.ts", import.meta.url),
  "utf8",
);

/** Endpoints that must never appear: writes, JQL execution, raw passthrough. */
const FORBIDDEN_PATH =
  /\/search"|\/search\/id|expression|issueLinkType|\/worklog|\/watchers|\/votes|attachment\/\d|raw|graphql/u;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

function jiraTools() {
  return tools().filter((tool) => tool.name.startsWith("jira_"));
}

function parameterKeys(tool: unknown): string[] {
  const definition = tool as {
    readonly parameters?: Record<string, unknown> | undefined;
  };
  return Object.keys(definition.parameters ?? {});
}

describe("Jira capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(JIRA_HANDLERS).sort()).toEqual(
      Object.keys(JIRA_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(JIRA_PROJECTIONS)) {
      expect(JIRA_OPERATIONS[operation], operation).toBeDefined();
    }
  });

  it("reaches read-only endpoints only", () => {
    const used = new Set<string>();
    for (const [operation, definition] of Object.entries(JIRA_OPERATIONS)) {
      expect(definition.method, operation).toBe("GET");
      expect(definition.path.startsWith("/rest/api/3/"), operation).toBe(true);
      expect(FORBIDDEN_PATH.test(definition.path), operation).toBe(false);
      expect(JIRA_READ_PATHS, operation).toContain(definition.path);
      used.add(definition.path);
    }
    // The allow-list is exact: nothing in it is dead, and no endpoint reaches
    // Jira without being declared here first.
    expect([...used].sort()).toEqual([...JIRA_READ_PATHS].sort());
    for (const forbidden of [
      "rest.call",
      "raw",
      "search.jql",
      "issues.create",
      "issues.update",
      "issues.transition",
      "issues.assign",
      "issues.comment",
      "attachments.download",
    ]) {
      expect(Object.keys(JIRA_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
      JIRA_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(JIRA_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
  });

  it("ties each capability to its own deployment switch", () => {
    const seenFlags = new Set<string>();
    const seenCapabilities = new Set<string>();
    for (const item of JIRA_CAPABILITIES) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
      expect(seenCapabilities.has(item.capability), item.capability).toBe(
        false,
      );
      seenCapabilities.add(item.capability);
    }
    expect(JIRA_CAPABILITIES.map((item) => item.capability)).toEqual([
      "identity.read",
      "issues.read",
      "comments.read",
      "attachments.read",
      "transitions.read",
      "projects.read",
      "fields.read",
    ]);
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    expect(enabledCapabilities(resolveConfig().jira)).toEqual([
      "identity.read",
      "issues.read",
      "comments.read",
      "attachments.read",
      "transitions.read",
      "projects.read",
      "fields.read",
    ]);
    expect(
      enabledCapabilities(
        resolveConfig({
          jira: {
            commentsRead: false,
            attachmentsRead: false,
            transitionsRead: false,
          },
        }).jira,
      ),
    ).toEqual(["identity.read", "issues.read", "projects.read", "fields.read"]);
  });

  it("keeps the tool surface free of raw JQL and of the legacy search endpoint", () => {
    // The include groups are a closed set; the catalog carries no JQL argument,
    // and it reads the endpoint Atlassian kept rather than the one it removed.
    expect([...ISSUE_INCLUDES]).toEqual([
      "description",
      "comments_summary",
      "attachments",
      "relations",
      "custom_fields",
    ]);
    expect(CATALOG_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
    expect(CATALOG_SOURCE).not.toMatch(/\bjql\s*:/iu);
    expect(CATALOG_SOURCE).toMatch(/"\/rest\/api\/3\/search\/jql"/u);
    expect(TOOLS_SOURCE).not.toMatch(/\bjql\s*:/iu);
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(JIRA_TOOL_NAMES.length);
    for (const operation of declared) {
      expect(JIRA_OPERATIONS[operation as string], operation).toBeDefined();
    }
  });

  it("sends the token in the Authorization header of a GET and nowhere else", () => {
    expect(TRANSPORT_SOURCE).toMatch(/method: "GET"/u);
    expect(TRANSPORT_SOURCE).toMatch(/redirect: "error"/u);
    expect(TRANSPORT_SOURCE).toMatch(/authorization: basicAuthorization/u);
    expect(TRANSPORT_SOURCE).toMatch(/Basic \$\{pair\}/u);
  });
});

describe("Jira tool surface", () => {
  it("registers the Jira names after the TeamCity ones", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([...INTEGRATION_TOOL_NAMES]);
    expect(names).toContain("jira_search_issues");
    expect(names.indexOf("jira_search_issues")).toBe(
      INTEGRATION_TOOL_NAMES.indexOf("jira_search_issues"),
    );
  });

  it("keeps principal, site and secret selectors out of every schema", () => {
    const schema = JSON.stringify(jiraTools());
    for (const forbidden of [
      "userId",
      "ownerUserId",
      "credentialId",
      "secretId",
      "integrationId",
      "siteId",
      "cloudId",
      "siteUrl",
      "baseUrl",
      "instanceId",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
    for (const tool of jiraTools()) {
      const keys = parameterKeys(tool);
      for (const forbidden of [
        "token",
        "jql",
        "site",
        "siteId",
        "cloudId",
        "email",
      ]) {
        expect(keys, `${tool.name}.${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("names every tool after the provider and ships no write stage", () => {
    for (const name of JIRA_TOOL_NAMES) {
      expect(name.startsWith("jira_")).toBe(true);
      // The specification's later write tools are `jira_prepare_*`: none exists
      // until the two-phase confirmation does.
      expect(name).not.toContain("prepare");
    }
    expect(new Set(JIRA_TOOL_NAMES).size).toBe(JIRA_TOOL_NAMES.length);
  });
});
