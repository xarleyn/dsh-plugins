import { readFileSync } from "node:fs";
import { resolveConfig } from "../src/config.js";
import {
  WEBLATE_CAPABILITIES,
  WEBLATE_OPERATIONS,
  enabledCapabilities,
} from "../src/providers/weblate/catalog.js";
import {
  WEBLATE_HANDLERS,
  WEBLATE_PROJECTIONS,
  WEBLATE_UNTRUSTED_OPERATIONS,
} from "../src/providers/weblate/operations.js";
import {
  UNIT_STATE_FILTERS,
  UNIT_TEXT_FIELDS,
} from "../src/providers/weblate/query.js";
import { WEBLATE_TOOL_NAMES } from "../src/providers/weblate/tools.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";

const ROOT = new URL("../src/providers/weblate/", import.meta.url);

function source(file: string): string {
  return readFileSync(new URL(file, ROOT), { encoding: "utf8" });
}

const TOOLS_SOURCE = source("tools.ts");
const CATALOG_SOURCE = source("catalog.ts");
const TRANSPORT_SOURCE = source("transport.ts");
const QUERY_SOURCE = source("query.ts");

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_VERB = /POST|PUT|PATCH|DELETE/u;

/**
 * Endpoints that change Weblate state or expose what this provider has no
 * business reading: repository operations, file upload and download,
 * automatic translation, addons, component links, locks, announcements,
 * backups, user and group administration.
 */
const FORBIDDEN_PATH =
  /\/(?:repository|file|autotranslate|addons|links|lock|announcements|backups|machinery|memory|roles|groups|tasks|reports|component-lists|categories|metrics)/u;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

describe("Weblate capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(WEBLATE_HANDLERS).sort()).toEqual(
      Object.keys(WEBLATE_OPERATIONS).sort(),
    );
    expect(Object.keys(WEBLATE_PROJECTIONS).sort()).toEqual(
      Object.keys(WEBLATE_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(WEBLATE_PROJECTIONS)) {
      expect(WEBLATE_OPERATIONS[operation], operation).toBeDefined();
    }
  });

  it("reaches read-only endpoints only", () => {
    for (const [operation, definition] of Object.entries(WEBLATE_OPERATIONS)) {
      expect(definition.path.startsWith("/"), operation).toBe(true);
      expect(WRITE_VERB.test(definition.path), operation).toBe(false);
      expect(FORBIDDEN_PATH.test(definition.path), operation).toBe(false);
    }
    for (const forbidden of [
      "rest.call",
      "raw_query",
      "units.update",
      "units.comment",
      "units.suggest",
      "units.approve",
      "translations.file",
      "translations.autotranslate",
      "repository.pull",
      "repository.push",
      "screenshots.upload",
      "users.list",
    ]) {
      expect(Object.keys(WEBLATE_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
      WEBLATE_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(WEBLATE_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
    // Every declared capability is reachable: an unreachable one would show in
    // the Settings card as a switch that does nothing.
    const used = new Set(
      Object.values(WEBLATE_OPERATIONS).map((item) => item.capability),
    );
    for (const item of WEBLATE_CAPABILITIES) {
      expect(used.has(item.capability), item.capability).toBe(true);
    }
  });

  it("ties each capability to its own deployment switch", () => {
    const seenFlags = new Set<string>();
    for (const item of WEBLATE_CAPABILITIES) {
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }
    expect(WEBLATE_CAPABILITIES.map((item) => item.capability)).toEqual([
      "identity.read",
      "projects.read",
      "components.read",
      "translations.read",
      "units.read",
      "checks.read",
      "comments.read",
      "suggestions.read",
      "changes.read",
      "statistics.read",
      "screenshots.read",
    ]);
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    const all = resolveConfig({
      weblate: {
        instances: [
          {
            id: "main",
            label: "Weblate",
            baseUrl: "https://weblate.example.com",
          },
        ],
      },
    }).weblate;
    expect(enabledCapabilities(all)).toEqual([
      "identity.read",
      "projects.read",
      "components.read",
      "translations.read",
      "units.read",
      "checks.read",
      "comments.read",
      "suggestions.read",
      "changes.read",
      "statistics.read",
      "screenshots.read",
    ]);
    expect(
      enabledCapabilities(
        resolveConfig({
          weblate: {
            instances: [
              {
                id: "main",
                label: "Weblate",
                baseUrl: "https://weblate.example.com",
              },
            ],
            screenshotsRead: false,
            changesRead: false,
          },
        }).weblate,
      ),
    ).not.toContain("screenshots.read");
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(WEBLATE_TOOL_NAMES.length);
    expect(declared.length).toBe(Object.keys(WEBLATE_OPERATIONS).length);
    for (const operation of declared) {
      expect(WEBLATE_OPERATIONS[operation as string], operation).toBeDefined();
    }
  });

  it("keeps the catalog free of any write verb", () => {
    expect(CATALOG_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
    expect(CATALOG_SOURCE).not.toMatch(/method:/u);
  });

  it("names only Weblate and no other provider of this package", () => {
    for (const file of [
      "catalog.ts",
      "config.ts",
      "index.ts",
      "operations.ts",
      "query.ts",
      "tools.ts",
      "transport.ts",
    ]) {
      expect(source(file), file).not.toMatch(
        /bitrix|confluence|gitlab|jira|teamcity/iu,
      );
    }
  });

  it("composes the search grammar instead of passing one through", () => {
    // The vocabulary is Weblate's own, and it is the only vocabulary this
    // provider can emit.
    expect([...UNIT_STATE_FILTERS]).toEqual([
      "untranslated",
      "needs-editing",
      "translated",
      "approved",
      "read-only",
    ]);
    expect([...UNIT_TEXT_FIELDS]).toEqual([
      "source",
      "target",
      "context",
      "note",
    ]);
    expect(QUERY_SOURCE).toMatch(/is:\$\{state\}/u);
  });
});

describe("Weblate tool surface", () => {
  interface Surface {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  }

  function surface(): readonly Surface[] {
    return tools().filter((tool) =>
      tool.name.startsWith("weblate_"),
    ) as unknown as readonly Surface[];
  }

  it("registers the Weblate names after the other providers", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([...INTEGRATION_TOOL_NAMES]);
    expect(names.indexOf("weblate_connection_get")).toBe(
      INTEGRATION_TOOL_NAMES.indexOf("weblate_connection_get"),
    );
    for (const name of WEBLATE_TOOL_NAMES) {
      expect(names).toContain(name);
    }
    expect(WEBLATE_TOOL_NAMES.length).toBe(
      Object.keys(WEBLATE_OPERATIONS).length,
    );
  });

  it("keeps principal, secret and address selectors out of every schema", () => {
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
      "instanceId",
      "baseUrl",
      "serverUrl",
      "host",
      "query",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("says out loud that external content is untrusted data", () => {
    for (const tool of surface()) {
      expect(tool.description, tool.name).toMatch(/[Rr]ead-only/u);
    }
    // Every answer that carries upstream-authored text says where it came from,
    // and the list is as long as the operations the provider marks as such.
    const unwrapped: readonly string[] = [
      "weblate_units_search",
      "weblate_units_find",
      "weblate_unit_get",
      "weblate_unit_comments_list",
      "weblate_unit_suggestions_list",
      "weblate_failing_units_list",
      "weblate_changes_list",
    ];
    expect(unwrapped).toHaveLength(WEBLATE_UNTRUSTED_OPERATIONS.length);
    for (const name of unwrapped) {
      const tool = surface().find((item) => item.name === name);
      expect(tool?.description, name).toMatch(/untrusted external content/u);
    }
    // The metadata answers do not pretend to carry any.
    for (const name of ["weblate_projects_list", "weblate_connection_get"]) {
      const tool = surface().find((item) => item.name === name);
      expect(tool?.description, name).not.toMatch(
        /untrusted external content/u,
      );
    }
  });

  it("cannot be pointed at a host, a file or a repository", () => {
    for (const forbidden of [
      "serverUrl:",
      "instanceId:",
      "baseUrl:",
      "raw_query",
      "raw_rest",
      "repository/",
      "autotranslate",
      "upload",
      "delete",
    ]) {
      expect(TOOLS_SOURCE).not.toContain(forbidden);
    }
  });

  it("sends the token in the Authorization header and nowhere else", () => {
    expect(TRANSPORT_SOURCE).toMatch(/authorization: `Token \$\{token\}`/u);
    expect(TRANSPORT_SOURCE).not.toMatch(/searchParams\.set\("token"/u);
    expect(TRANSPORT_SOURCE).toMatch(/redirect: "error"|fetchWithRetries/u);
  });
});
