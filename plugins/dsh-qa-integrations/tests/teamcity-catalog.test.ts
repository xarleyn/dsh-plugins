import { readFileSync } from "node:fs";
import { resolveConfig } from "../src/config.js";
import {
  TEAMCITY_CAPABILITIES,
  TEAMCITY_OPERATIONS,
  TEAMCITY_STREAM_OPERATIONS,
  enabledCapabilities,
} from "../src/providers/teamcity/catalog.js";
import {
  TEAMCITY_HANDLERS,
  TEAMCITY_PROJECTIONS,
} from "../src/providers/teamcity/operations.js";
import { TEAMCITY_TOOL_NAMES } from "../src/providers/teamcity/tools.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";

const TOOLS_SOURCE = readFileSync(
  new URL("../src/providers/teamcity/tools.ts", import.meta.url),
  "utf8",
);
const CATALOG_SOURCE = readFileSync(
  new URL("../src/providers/teamcity/catalog.ts", import.meta.url),
  "utf8",
);

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_VERB = /POST|PUT|PATCH|DELETE/u;
/**
 * Endpoints that change TeamCity state or expose configuration the provider has
 * no business reading: parameters, resulting properties, tags, comments, queue
 * mutations, agent administration, mutes, user and project administration.
 */
const FORBIDDEN_PATH =
  /\/(?:parameters|resulting-properties|tags|comment|pin|mutes|investigations\/\d|agents\/\d|users|roles|vcs-roots|steps|features|triggers|templates|projects\/\d+\/parameters)/u;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

describe("TeamCity capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(TEAMCITY_HANDLERS).sort()).toEqual(
      Object.keys(TEAMCITY_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(TEAMCITY_PROJECTIONS)) {
      expect(TEAMCITY_OPERATIONS[operation], operation).toBeDefined();
    }
    // The two operations that answer with a bounded window of text are assembled
    // in the provider, so they have a request builder and no JSON projection.
    expect(TEAMCITY_STREAM_OPERATIONS).toEqual([
      "builds.log",
      "artifacts.text",
    ]);
    for (const operation of TEAMCITY_STREAM_OPERATIONS) {
      expect(Object.keys(TEAMCITY_HANDLERS)).toContain(operation);
      expect(TEAMCITY_PROJECTIONS[operation]).toBeUndefined();
    }
  });

  it("reaches read-only endpoints only", () => {
    for (const [operation, definition] of Object.entries(TEAMCITY_OPERATIONS)) {
      expect(definition.method, operation).toBe("GET");
      expect(definition.path.startsWith("/"), operation).toBe(true);
      expect(WRITE_VERB.test(definition.path), operation).toBe(false);
      expect(FORBIDDEN_PATH.test(definition.path), operation).toBe(false);
    }
    for (const forbidden of [
      "raw_rest",
      "rest.call",
      "builds.trigger",
      "builds.retry",
      "builds.cancel",
      "builds.comment",
      "builds.tags",
      "agents.authorize",
      "investigations.create",
      "mutes.create",
    ]) {
      expect(Object.keys(TEAMCITY_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
      TEAMCITY_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(TEAMCITY_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
  });

  it("ties each capability to its own deployment switch", () => {
    const seenFlags = new Set<string>();
    for (const item of TEAMCITY_CAPABILITIES) {
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }
    expect(TEAMCITY_CAPABILITIES.map((item) => item.capability)).toEqual([
      "identity.read",
      "projects.read",
      "buildConfigs.read",
      "builds.read",
      "failures.read",
      "logs.read",
      "queue.read",
      "investigations.read",
      "agents.read",
      "artifacts.read",
    ]);
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    const flags = resolveConfig({
      teamcity: { network: { allowedHosts: ["teamcity.example.com"] } },
    }).teamcity;
    expect(enabledCapabilities(flags)).toEqual([
      "identity.read",
      "projects.read",
      "buildConfigs.read",
      "builds.read",
      "failures.read",
      "logs.read",
      "queue.read",
      "investigations.read",
      "agents.read",
      "artifacts.read",
    ]);
    expect(
      enabledCapabilities(
        resolveConfig({
          teamcity: {
            network: { allowedHosts: ["teamcity.example.com"] },
            logsRead: false,
            artifactsRead: false,
          },
        }).teamcity,
      ),
    ).not.toContain("logs.read");
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(TEAMCITY_TOOL_NAMES.length);
    expect(declared.length).toBe(Object.keys(TEAMCITY_OPERATIONS).length);
    for (const operation of declared) {
      expect(TEAMCITY_OPERATIONS[operation as string], operation).toBeDefined();
    }
  });

  it("keeps the catalog free of any write verb", () => {
    expect(CATALOG_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
    expect(CATALOG_SOURCE).toMatch(/method: "GET"/u);
  });
});

describe("TeamCity tool surface", () => {
  interface Surface {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  }

  function surface(): readonly Surface[] {
    return tools().filter((tool) =>
      tool.name.startsWith("teamcity_"),
    ) as unknown as readonly Surface[];
  }

  it("registers the TeamCity names after the other providers", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([...INTEGRATION_TOOL_NAMES]);
    expect(names.indexOf("teamcity_connection_get")).toBe(
      INTEGRATION_TOOL_NAMES.indexOf("teamcity_connection_get"),
    );
    for (const name of TEAMCITY_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("keeps principal, secret and server selectors out of every schema", () => {
    // Only the argument schemas are checked: descriptions are prose and are
    // allowed to say the word "token".
    const schema = JSON.stringify(
      surface().map((tool) => ({
        name: tool.name,
        parameters: tool.parameters,
      })),
    );
    for (const forbidden of [
      "userId",
      "ownerUserId",
      "credentialId",
      "secretId",
      "accessToken",
      "refreshToken",
      "integrationId",
      "serverUrl",
      "instanceId",
      "locator",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("says out loud that external content is untrusted data", () => {
    for (const tool of surface()) {
      expect(tool.description, tool.name).toMatch(/[Rr]ead-only/u);
    }
    for (const name of ["teamcity_build_log", "teamcity_artifact_text"]) {
      const tool = surface().find((item) => item.name === name);
      expect(tool?.description, name).toMatch(/untrusted external content/u);
    }
  });
});
