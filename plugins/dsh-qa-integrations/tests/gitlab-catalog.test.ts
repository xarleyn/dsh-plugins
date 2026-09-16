import { readFileSync } from "node:fs";
import { resolveConfig } from "../src/config.js";
import {
  GITLAB_CAPABILITIES,
  GITLAB_OPERATIONS,
  capabilitiesForScopes,
  enabledCapabilities,
} from "../src/providers/gitlab/catalog.js";
import {
  GITLAB_HANDLERS,
  GITLAB_PROJECTIONS,
} from "../src/providers/gitlab/operations.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";
import { GITLAB_TOOL_NAMES } from "../src/providers/gitlab/tools.js";

const TOOLS_SOURCE = readFileSync(
  new URL("../src/providers/gitlab/tools.ts", import.meta.url),
  "utf8",
);
const CATALOG_SOURCE = readFileSync(
  new URL("../src/providers/gitlab/catalog.ts", import.meta.url),
  "utf8",
);

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_VERB = /POST|PUT|PATCH|DELETE/u;
/** Paths that must never appear: the surface is reads only. */
const FORBIDDEN_PATH =
  /repository\/files\/.+\/raw$|\/keys|\/hooks|\/members|\/variables|\/badges|\/runners|\/deploy_tokens|\/access_tokens|sudo|\/approve$|\/merge$/u;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

describe("GitLab capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(GITLAB_HANDLERS).sort()).toEqual(
      Object.keys(GITLAB_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(GITLAB_PROJECTIONS)) {
      expect(GITLAB_OPERATIONS[operation], operation).toBeDefined();
    }
    // The one operation that reads a stream instead of JSON is handled in the
    // provider itself, so it has neither handler-side projection nor envelope.
    expect(GITLAB_PROJECTIONS["jobs.log"]).toBeUndefined();
    expect(GITLAB_OPERATIONS["jobs.log"]).toBeDefined();
  });

  it("reaches read-only endpoints only", () => {
    for (const [operation, definition] of Object.entries(GITLAB_OPERATIONS)) {
      expect(definition.path.startsWith("/"), operation).toBe(true);
      expect(WRITE_VERB.test(definition.path), operation).toBe(false);
      expect(FORBIDDEN_PATH.test(definition.path), operation).toBe(false);
    }
    for (const forbidden of [
      "raw_api",
      "raw_graphql",
      "graphql",
      "batch",
      "sudo",
    ]) {
      expect(Object.keys(GITLAB_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
      GITLAB_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(GITLAB_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
  });

  it("ties each capability to its own GitLab scopes and deployment switch", () => {
    const seenFlags = new Set<string>();
    for (const item of GITLAB_CAPABILITIES) {
      expect(item.scopes.length).toBeGreaterThan(0);
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
      // GitLab has no per-area read scope beyond read_api, so the read
      // scopes repeat across capabilities on purpose.
      for (const scope of item.scopes) {
        expect(scope).toMatch(/^[a-z_]+$/u);
      }
    }
    expect(GITLAB_CAPABILITIES.map((item) => item.capability)).toEqual([
      "identity.read",
      "projects.read",
      "repository.read",
      "search.read",
      "issues.read",
      "merge_requests.read",
      "ci.read",
    ]);
  });

  it("derives capabilities from the scopes a token reports", () => {
    expect(capabilitiesForScopes(["read_user"])).toEqual(["identity.read"]);
    expect(capabilitiesForScopes(["read_repository"])).toEqual([
      "repository.read",
    ]);
    expect(capabilitiesForScopes(["read_api"])).toEqual([
      "identity.read",
      "projects.read",
      "repository.read",
      "search.read",
      "issues.read",
      "merge_requests.read",
      "ci.read",
    ]);
    expect(capabilitiesForScopes(["write_repository"])).toEqual([]);
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    expect(enabledCapabilities(resolveConfig().gitlab)).toEqual([
      "identity.read",
      "projects.read",
      "repository.read",
      "search.read",
      "issues.read",
      "merge_requests.read",
      "ci.read",
    ]);
    expect(
      enabledCapabilities(
        resolveConfig({ gitlab: { searchRead: false, ciRead: false } }).gitlab,
      ),
    ).toEqual([
      "identity.read",
      "projects.read",
      "repository.read",
      "issues.read",
      "merge_requests.read",
    ]);
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(GITLAB_TOOL_NAMES.length);
    for (const operation of declared) {
      expect(GITLAB_OPERATIONS[operation as string], operation).toBeDefined();
    }
  });

  it("keeps the catalog free of GraphQL and of any write verb", () => {
    expect(CATALOG_SOURCE).not.toMatch(/graphql/iu);
    expect(CATALOG_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
  });
});

describe("GitLab tool surface", () => {
  it("registers the GitLab names after the Bitrix24 ones", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([...INTEGRATION_TOOL_NAMES]);
    expect(names).toContain("gitlab_connection_get");
    expect(names.indexOf("gitlab_connection_get")).toBe(
      INTEGRATION_TOOL_NAMES.indexOf("gitlab_connection_get"),
    );
  });

  it("keeps principal and secret selectors out of every schema", () => {
    const schema = JSON.stringify(
      tools().filter((tool) => tool.name.startsWith("gitlab_")),
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
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });
});
