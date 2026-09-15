import { readFileSync } from "node:fs";
import {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
  enabledCapabilities,
} from "../src/catalog.js";
import { resolveConfig } from "../src/config.js";
import {
  BITRIX_HANDLERS,
  BITRIX_PROJECTIONS,
} from "../src/providers/bitrix24-operations.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
} from "../src/tools.js";

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_METHOD =
  /\.(add|update|delete|set|unset|bind|unbind|move|import|start|complete|renew|send|create|register)$/u;

const TOOLS_SOURCE = readFileSync(
  new URL("../src/tools.ts", import.meta.url),
  "utf8",
);

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

describe("Bitrix24 capability catalog", () => {
  it("describes every operation and leaves no handler orphaned", () => {
    expect(Object.keys(BITRIX_HANDLERS).sort()).toEqual(
      Object.keys(BITRIX_OPERATIONS).sort(),
    );
    for (const operation of Object.keys(BITRIX_PROJECTIONS)) {
      expect(BITRIX_OPERATIONS[operation], operation).toBeDefined();
    }
  });

  it("reaches read-only methods only", () => {
    for (const [operation, definition] of Object.entries(BITRIX_OPERATIONS)) {
      expect(
        WRITE_METHOD.test(definition.method),
        `${operation} calls ${definition.method}`,
      ).toBe(false);
    }
    for (const forbidden of ["raw_rest", "raw_mcp", "batch", "method.get"]) {
      expect(Object.keys(BITRIX_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set(
      BITRIX_CAPABILITIES.map((item) => item.capability),
    );
    for (const definition of Object.values(BITRIX_OPERATIONS)) {
      expect(declared.has(definition.capability)).toBe(true);
    }
  });

  it("ties each capability to its own Bitrix24 scope and deployment switch", () => {
    const seenScopes = new Set<string>();
    const seenFlags = new Set<string>();
    for (const item of BITRIX_CAPABILITIES) {
      expect(item.scopes.length).toBeGreaterThan(0);
      expect(seenFlags.has(item.flag), item.flag).toBe(false);
      seenFlags.add(item.flag);
      // user_brief, user_basic and user are three grants of one capability.
      if (item.capability === "user.read") continue;
      for (const scope of item.scopes) {
        expect(seenScopes.has(scope), scope).toBe(false);
        seenScopes.add(scope);
      }
    }
  });

  it("derives the enabled capabilities from the deployment switches", () => {
    expect(enabledCapabilities(resolveConfig().bitrix24)).toEqual([
      "crm.read",
      "chat.read",
      "openlines.read",
      "user.read",
      "department.read",
      "tasks.read",
      "calendar.read",
      "disk.read",
    ]);
    expect(
      enabledCapabilities(
        resolveConfig({ bitrix24: { crmRead: false, diskRead: false } })
          .bitrix24,
      ),
    ).toEqual([
      "chat.read",
      "openlines.read",
      "user.read",
      "department.read",
      "tasks.read",
      "calendar.read",
    ]);
  });

  it("declares each operation exactly once per tool", () => {
    const declared = [...TOOLS_SOURCE.matchAll(/operation: "([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(declared).toHaveLength(INTEGRATION_TOOL_NAMES.length);
    for (const operation of declared) {
      expect(BITRIX_OPERATIONS[operation as string], operation).toBeDefined();
    }
  });
});

describe("Bitrix24 tool surface", () => {
  it("registers exactly the exported names, in order", () => {
    expect(tools().map((tool) => tool.name)).toEqual([
      ...INTEGRATION_TOOL_NAMES,
    ]);
  });

  it("keeps principal and secret selectors out of every schema", () => {
    const schema = JSON.stringify(tools());
    for (const forbidden of [
      "userId",
      "ownerUserId",
      "credentialId",
      "secretId",
      "accessToken",
      "refreshToken",
      "integrationId",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });
});
