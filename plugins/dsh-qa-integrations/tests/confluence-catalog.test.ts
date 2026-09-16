import { readFileSync } from "node:fs";
import { resolveConfig } from "../src/config.js";
import {
  CONFLUENCE_CAPABILITIES,
  CONFLUENCE_OPERATIONS,
  enabledCapabilities,
} from "../src/providers/confluence/catalog.js";
import {
  CONFLUENCE_HANDLERS,
  CONFLUENCE_PROJECTIONS,
} from "../src/providers/confluence/operations.js";
import { CONFLUENCE_TOOL_NAMES } from "../src/providers/confluence/tools.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";

const TOOLS_SOURCE = readFileSync(
  new URL("../src/providers/confluence/tools.ts", import.meta.url),
  "utf8",
);
const CATALOG_SOURCE = readFileSync(
  new URL("../src/providers/confluence/catalog.ts", import.meta.url),
  "utf8",
);

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_VERB = /POST|PUT|PATCH|DELETE/u;
/**
 * Endpoints that must never appear: the retired v1 content API, the space
 * administration surface, and every collection that exists to change something.
 */
const FORBIDDEN_PATH =
  /\/rest\/api\/content|\/admin|properties|operations|likes|watchers|permissions|restrictions|blueprint|template|\/versions\/\d|\/children|\/copy|\/move/u;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

describe("Confluence capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(CONFLUENCE_HANDLERS).sort()).toEqual(
      Object.keys(CONFLUENCE_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(CONFLUENCE_PROJECTIONS)) {
      expect(CONFLUENCE_OPERATIONS[operation], operation).toBeDefined();
    }
  });

  it("reaches read-only endpoints only", () => {
    for (const [operation, definition] of Object.entries(
      CONFLUENCE_OPERATIONS,
    )) {
      expect(definition.method, operation).toBe("GET");
      expect(definition.path.startsWith("/"), operation).toBe(true);
      expect(WRITE_VERB.test(definition.path), operation).toBe(false);
      expect(FORBIDDEN_PATH.test(definition.path), operation).toBe(false);
    }
    for (const forbidden of [
      "search.cql",
      "content.raw",
      "rest.call",
      "attachment.get",
      "pages.update",
    ]) {
      expect(Object.keys(CONFLUENCE_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
      CONFLUENCE_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(CONFLUENCE_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
  });

  it("ties each capability to its own deployment switch", () => {
    const seenFlags = new Set<string>();
    for (const item of CONFLUENCE_CAPABILITIES) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
    }
    expect(CONFLUENCE_CAPABILITIES.map((item) => item.capability)).toEqual([
      "identity.read",
      "spaces.read",
      "search.read",
      "content.read",
      "comments.read",
      "attachments.read",
      "versions.read",
    ]);
  });

  it("declares how a listing pages, and never for a single read", () => {
    for (const [operation, definition] of Object.entries(
      CONFLUENCE_OPERATIONS,
    )) {
      if (definition.list === true) {
        expect(["offset", "upstream"], operation).toContain(definition.cursor);
      } else {
        expect(definition.cursor, operation).toBeUndefined();
      }
    }
    // The only offset-based read is the v1 search endpoint.
    expect(CONFLUENCE_OPERATIONS["search.run"]?.cursor).toBe("offset");
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    expect(enabledCapabilities(resolveConfig().confluence)).toEqual([
      "identity.read",
      "spaces.read",
      "search.read",
      "content.read",
      "comments.read",
      "attachments.read",
      "versions.read",
    ]);
    expect(
      enabledCapabilities(
        resolveConfig({
          confluence: {
            searchRead: false,
            commentsRead: false,
            versionsRead: false,
          },
        }).confluence,
      ),
    ).toEqual([
      "identity.read",
      "spaces.read",
      "content.read",
      "attachments.read",
    ]);
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(CONFLUENCE_TOOL_NAMES.length);
    for (const operation of declared) {
      expect(
        CONFLUENCE_OPERATIONS[operation as string],
        operation,
      ).toBeDefined();
    }
    const paths = [...CATALOG_SOURCE.matchAll(/\bpath: "([^"]+)"/gu)];
    expect(paths).toHaveLength(Object.keys(CONFLUENCE_OPERATIONS).length);
  });

  it("keeps the catalog free of any write verb", () => {
    expect(CATALOG_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
    expect(TOOLS_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
  });
});

describe("Confluence tool surface", () => {
  it("registers the Confluence names in the composed list", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([...INTEGRATION_TOOL_NAMES]);
    for (const name of CONFLUENCE_TOOL_NAMES) {
      expect(names).toContain(name);
      expect(names.indexOf(name)).toBe(INTEGRATION_TOOL_NAMES.indexOf(name));
    }
  });

  it("ships no raw REST, raw CQL or attachment-body tool", () => {
    for (const forbidden of [
      "confluence_rest_call",
      "confluence_request",
      "confluence_execute_cql_raw",
      "confluence_search_cql",
      "confluence_get_attachment",
      "confluence_create_page",
      "confluence_update_page",
    ]) {
      expect(CONFLUENCE_TOOL_NAMES).not.toContain(forbidden);
    }
  });

  it("keeps principal, secret and site selectors out of every schema", () => {
    const schema = JSON.stringify(
      tools().filter((tool) => tool.name.startsWith("confluence_")),
    );
    for (const forbidden of [
      "userId",
      "ownerUserId",
      "credentialId",
      "secretId",
      "accessToken",
      "refreshToken",
      "integrationId",
      "instanceId",
      "cloudId",
      'accountId"',
      "siteAlias",
      "baseUrl",
      "email",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("marks every tool read-only and every content answer untrusted", () => {
    const confluence = tools().filter((tool) =>
      tool.name.startsWith("confluence_"),
    );
    for (const tool of confluence) {
      expect(tool.description, tool.name).toMatch(/read-only/iu);
    }
    for (const name of [
      "confluence_search",
      "confluence_get_page",
      "confluence_get_page_comments",
      "confluence_get_space",
    ]) {
      const tool = confluence.find((item) => item.name === name);
      expect(tool?.description, name).toMatch(/untrusted external content/u);
    }
  });
});
