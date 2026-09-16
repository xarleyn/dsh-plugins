import { readFileSync } from "node:fs";
import { resolveConfig } from "../src/config.js";
import {
  TESTIT_CAPABILITIES,
  TESTIT_OPERATIONS,
  enabledCapabilities,
} from "../src/providers/testit/catalog.js";
import {
  TESTIT_HANDLERS,
  TESTIT_PROJECTIONS,
} from "../src/providers/testit/operations.js";
import { TESTIT_TOOL_NAMES } from "../src/providers/testit/tools.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";

const TOOLS_SOURCE = readFileSync(
  new URL("../src/providers/testit/tools.ts", import.meta.url),
  "utf8",
);
const CATALOG_SOURCE = readFileSync(
  new URL("../src/providers/testit/catalog.ts", import.meta.url),
  "utf8",
);

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_VERB = /POST|PUT|PATCH|DELETE/u;
/**
 * Endpoints that change Test IT state or read what this provider has no business
 * reading: every search endpoint (all of them are POST), likes, moves, checklist
 * transforms, "set as actual", project purge and restore, demo seeding,
 * favourites, webhook and parameter administration, user administration and the
 * background job queue.
 */
const FORBIDDEN_PATH =
  /\/(?:search|like|move|purge|restore|demo|favorite|actual|transform|webhooks|parameters|users|roles|backgroundJobs|globalAttributes)/u;

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

describe("Test IT capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(TESTIT_HANDLERS).sort()).toEqual(
      Object.keys(TESTIT_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(TESTIT_PROJECTIONS)) {
      expect(TESTIT_OPERATIONS[operation], operation).toBeDefined();
    }
    // The attachment read answers with bytes rather than JSON, so it has a
    // request builder and no projection; the provider assembles its answer.
    expect(TESTIT_OPERATIONS["attachments.text"]?.stream).toBe(true);
    expect(TESTIT_PROJECTIONS["attachments.text"]).toBeUndefined();
    const streamed = Object.entries(TESTIT_OPERATIONS)
      .filter(([, definition]) => definition.stream === true)
      .map(([operation]) => operation);
    expect(streamed).toEqual(["attachments.text"]);
  });

  it("reaches read-only endpoints only", () => {
    for (const [operation, definition] of Object.entries(TESTIT_OPERATIONS)) {
      expect(definition.method, operation).toBe("GET");
      expect(definition.path.startsWith("/"), operation).toBe(true);
      expect(WRITE_VERB.test(definition.path), operation).toBe(false);
      expect(FORBIDDEN_PATH.test(definition.path), operation).toBe(false);
    }
    for (const forbidden of [
      "raw_rest",
      "rest.call",
      "search.global",
      "workItems.create",
      "workItems.update",
      "workItems.delete",
      "workItems.move",
      "workItems.like",
      "comments.create",
      "testRuns.create",
      "testRuns.start",
      "testRuns.complete",
      "testRuns.statistics",
      "testResults.statistics",
      "attachments.upload",
      "autoTests.update",
      "configurations.create",
      "projects.purge",
      "webhooks.list",
    ]) {
      expect(Object.keys(TESTIT_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
      TESTIT_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(TESTIT_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
  });

  it("ties each capability to its own deployment switch", () => {
    const seenFlags = new Set<string>();
    for (const item of TESTIT_CAPABILITIES) {
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }
    expect(TESTIT_CAPABILITIES.map((item) => item.capability)).toEqual([
      "projects.read",
      "sections.read",
      "workItems.read",
      "history.read",
      "comments.read",
      "testPlans.read",
      "testRuns.read",
      "testResults.read",
      "autoTests.read",
      "attachments.read",
      "configurations.read",
    ]);
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    const flags = resolveConfig({}).testit;
    expect(enabledCapabilities(flags)).toEqual([
      "projects.read",
      "sections.read",
      "workItems.read",
      "history.read",
      "comments.read",
      "testPlans.read",
      "testRuns.read",
      "testResults.read",
      "autoTests.read",
      "attachments.read",
      "configurations.read",
    ]);
    const narrowed = resolveConfig({
      testit: { commentsRead: false, attachmentsRead: false },
    }).testit;
    expect(enabledCapabilities(narrowed)).not.toContain("comments.read");
    expect(enabledCapabilities(narrowed)).not.toContain("attachments.read");
    expect(enabledCapabilities(narrowed)).toContain("workItems.read");
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(TESTIT_TOOL_NAMES.length);
    expect(declared.length).toBe(Object.keys(TESTIT_OPERATIONS).length);
    for (const operation of declared) {
      expect(TESTIT_OPERATIONS[operation as string], operation).toBeDefined();
    }
  });

  it("keeps the catalog free of any write verb", () => {
    expect(CATALOG_SOURCE).not.toMatch(/method: "(?:POST|PUT|PATCH|DELETE)"/u);
    expect(CATALOG_SOURCE).toMatch(/method: "GET"/u);
  });
});

describe("Test IT tool surface", () => {
  interface Surface {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  }

  function surface(): readonly Surface[] {
    return tools().filter((tool) =>
      tool.name.startsWith("testit_"),
    ) as unknown as readonly Surface[];
  }

  it("registers the Test IT names after every other provider", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([...INTEGRATION_TOOL_NAMES]);
    expect(names.indexOf("testit_connection_get")).toBe(
      INTEGRATION_TOOL_NAMES.indexOf("testit_connection_get"),
    );
    for (const name of TESTIT_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("keeps principal, secret and installation selectors out of every schema", () => {
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
      "privateToken",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("says out loud that external content is untrusted data", () => {
    for (const tool of surface()) {
      expect(tool.description, tool.name).toMatch(/[Rr]ead-only/u);
    }
    for (const name of [
      "testit_work_item_get",
      "testit_work_item_comments",
      "testit_test_result_get",
      "testit_attachment_text",
    ]) {
      const tool = surface().find((item) => item.name === name);
      expect(tool?.description, name).toMatch(/untrusted external content/u);
    }
  });
});
