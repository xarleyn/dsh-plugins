import { readFileSync } from "node:fs";
import {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
  enabledCapabilities,
} from "../src/providers/bitrix24/catalog.js";
import { resolveConfig } from "../src/config.js";
import {
  BITRIX_HANDLERS,
  BITRIX_PROJECTIONS,
} from "../src/providers/bitrix24/operations.js";
import {
  BITRIX24_COMMENT_TOOL_NAME,
  BITRIX24_TOOL_NAMES,
} from "../src/providers/bitrix24/tools.js";
import {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
  integrationToolNames,
} from "../src/tools.js";

/** Verbs that would turn this read-only surface into a writing one. */
const WRITE_METHOD =
  /\.(add|update|delete|set|unset|bind|unbind|move|import|start|complete|renew|send|create|register)$/u;

const TOOLS_SOURCE = readFileSync(
  new URL("../src/providers/bitrix24/tools.ts", import.meta.url),
  "utf8",
);

function tools() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
  });
}

function toolsWithCommentWrite() {
  return createIntegrationTools({
    broker: { call: async () => undefined } as never,
    principalForSession: () => undefined,
    bitrix24CrmCommentWrite: true,
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
      if (!WRITE_METHOD.test(definition.method)) continue;
      // The one writing method is the timeline comment, and it must stay
      // pinned to the write capability: a write operation under a read
      // capability would turn every read-only deployment into a writing one.
      expect(definition.capability, operation).toBe("crm.comment.write");
    }
    for (const forbidden of ["raw_rest", "raw_mcp", "batch", "method.get"]) {
      expect(Object.keys(BITRIX_OPERATIONS)).not.toContain(forbidden);
    }
  });

  it("maps every operation onto a declared capability", () => {
    const declared = new Set<string>(
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
        // The write capability rides the same `crm` scope as the read one:
        // Bitrix24 has no read-only webhook scope, which is exactly why the
        // capability exists — its deployment switch is the real gate.
        if (
          item.capability === "crm.comment.write" &&
          (scope === "crm" || seenScopes.has(scope))
        ) {
          continue;
        }
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
      enabledCapabilities(resolveConfig().bitrix24),
    ).not.toContain("crm.comment.write");
    expect(
      enabledCapabilities(
        resolveConfig({ bitrix24: { crmCommentWrite: true } }).bitrix24,
      ),
    ).toEqual([
      "crm.read",
      "crm.comment.write",
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
    // One declaration per tool: the read catalog plus the timeline comment,
    // which is declared in the source but mounted only behind its flag.
    expect(declared).toHaveLength(BITRIX24_TOOL_NAMES.length + 1);
    expect(new Set(declared).size).toBe(declared.length);
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

  it("mounts the timeline comment only behind its switch, with the admission list", async () => {
    const names = tools().map((tool) => tool.name);
    expect(names).not.toContain(BITRIX24_COMMENT_TOOL_NAME);

    const withWrite = toolsWithCommentWrite().map((tool) => tool.name);
    expect(withWrite).toEqual([
      ...integrationToolNames({ bitrix24CrmCommentWrite: true }),
    ]);
    expect(
      withWrite.filter((name) => name !== BITRIX24_COMMENT_TOOL_NAME),
    ).toEqual(names);
    // The comment tool mounts at the end of the Bitrix24 block, where the
    // provider module composes it.
    expect(withWrite.indexOf(BITRIX24_COMMENT_TOOL_NAME)).toBe(
      BITRIX24_TOOL_NAMES.length,
    );

    // The mounted write tool routes to the write operation like every read
    // tool routes to its own, so the broker's capability gate stays in charge.
    const operations: string[] = [];
    const routed = createIntegrationTools({
      broker: {
        call: async (_principal, request) => {
          operations.push(request.operation);
          return { provider: "bitrix24", operation: request.operation, data: {} };
        },
      } as never,
      principalForSession: () => ({ userId: "alice" }),
      bitrix24CrmCommentWrite: true,
    });
    const comment = routed.find(
      (tool) => tool.name === BITRIX24_COMMENT_TOOL_NAME,
    );
    expect(comment).toBeDefined();
    await comment!.execute(
      { entityTypeId: 2, entityId: 10, comment: "Проверка" } as never,
      { agent: { session: { header: { id: "owned" } } } } as never,
    );
    expect(operations).toEqual(["crm.timelineCommentAdd"]);
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
    // The write tool widens the surface; its schema stays equally clean.
    for (const forbidden of ["credentialId", "secretId", "accessToken"]) {
      expect(JSON.stringify(toolsWithCommentWrite())).not.toContain(forbidden);
    }
  });
});

describe("provider boundary", () => {
  /**
   * Shared engine: it moves provider ids around and must know none of them.
   * `config.ts`, `index.ts` and `tools.ts` are composition roots and do name the
   * providers they mount — that is the whole point of keeping the list short.
   */
  const SHARED = [
    "broker.ts",
    "repository.ts",
    "types.ts",
    "tool-kit.ts",
    "coerce.ts",
    "providers/contract.ts",
    "providers/registry.ts",
    "secrets/key-provider.ts",
    "secrets/secret-store.ts",
  ];

  it("keeps every provider's name out of the shared modules", () => {
    for (const file of SHARED) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), {
        encoding: "utf8",
      });
      // Any provider's name in the shared engine means the abstraction is gone;
      // the composition roots are the only places allowed to name them.
      expect(source, `${file} must stay provider-agnostic`).not.toMatch(
        /bitrix|confluence|gitlab|jira|teamcity|testit|weblate/iu,
      );
    }
  });

  it("brings its own tests instead of living in the Bitrix24 ones", () => {
    // The broker suite drives a made-up provider, which is what proves the
    // boundary: if it ever needs Bitrix24 to pass, the abstraction is gone.
    const brokerSuite = readFileSync(
      new URL("./broker-isolation.test.ts", import.meta.url),
      { encoding: "utf8" },
    );
    expect(brokerSuite).not.toMatch(
      /bitrix|confluence|gitlab|jira|teamcity|testit|weblate/iu,
    );
  });
});
