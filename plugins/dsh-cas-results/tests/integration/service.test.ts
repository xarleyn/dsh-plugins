/**
 * Integration tests for the Cordis service wiring: listener registration,
 * tool registration, public store surface, and dispose symmetry.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CasResultsService } from "../../src/service.js";
import type { CasResultsConfig } from "../../src/config.js";
import type { CasPostExecuteListener } from "../../src/integration/post-execute.js";
import { silentPluginLogger, tempRoot } from "../fixtures/store-fixtures.js";
import { makeText } from "../fixtures/store-fixtures.js";

const encoder = new TextEncoder();

afterEach(async () => {
  // Temp roots register through tempRoot's cleanup in fixtures usage below.
});

interface CapturedSurface {
  listeners: CasPostExecuteListener[];
  tools: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }[];
}

interface Wiring {
  service: CasResultsService;
  ctx: Context;
  surface: CapturedSurface;
  root: string;
}

async function wire(overrides: Record<string, unknown> = {}): Promise<Wiring> {
  const root = await tempRoot();
  const ctx = new Context();
  const surface: CapturedSurface = { listeners: [], tools: [] };
  const toolCtx = {
    tools: {
      register(definition: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }) {
        surface.tools.push(definition);
        return () => undefined;
      },
    },
    on(event: "tools/post-execute", listener: CasPostExecuteListener) {
      surface.listeners.push(listener);
      return () => undefined;
    },
  };
  // The test harness has no `tools` service; capture the registration
  // callback synchronously instead of waiting for injection.
  (ctx as unknown as { inject: (services: readonly string[], cb: (c: unknown) => void) => () => void }).inject = (
    _services,
    cb,
  ) => {
    cb(toolCtx);
    return () => undefined;
  };
  const service = new CasResultsService(
    ctx,
    { gc: { enabled: false }, ...overrides } as CasResultsConfig,
    { storeRoot: root, logger: silentPluginLogger() },
  );
  return { service, ctx, surface, root };
}

async function dispose(wiring: Wiring): Promise<void> {
  (wiring.service as unknown as { dispose(): void }).dispose();
  const root = wiring.root;
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

describe("CasResultsService wiring", () => {
  it("registers the post-execute listener and the dsh_cas_* tools", async () => {
    const wiring = await wire({ exposeGcTool: true });
    expect(wiring.surface.listeners).toHaveLength(1);
    expect(wiring.surface.tools.map((tool) => tool.name)).toEqual([
      "dsh_cas_retrieve",
      "dsh_cas_search",
      "dsh_cas_info",
      "dsh_cas_stats",
      "dsh_cas_gc",
    ]);
    await dispose(wiring);
  });

  it("omits dsh_cas_gc unless explicitly exposed (SPEC §20)", async () => {
    const wiring = await wire();
    expect(wiring.surface.tools.map((tool) => tool.name)).toEqual([
      "dsh_cas_retrieve",
      "dsh_cas_search",
      "dsh_cas_info",
      "dsh_cas_stats",
    ]);
    await dispose(wiring);
  });

  it("exposes the shared store surface to other plugins (SPEC §35)", async () => {
    const wiring = await wire();
    const payload = encoder.encode(makeText(2_048));
    const object = await wiring.service.put({ payload, kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const read = await wiring.service.read(object.ref);
    expect(Buffer.from(read.bytes).equals(Buffer.from(payload))).toBe(true);
    expect(await wiring.service.stat(object.ref)).toMatchObject({ hash: object.ref.replace("sha256:", "") });
    const search = await wiring.service.search(object.ref, { query: "line" });
    expect(search.totalMatches).toBeGreaterThan(0);
    const stats = await wiring.service.stats();
    expect(stats.objects).toBe(1);
    expect(stats.runtime.objectsStored).toBe(1);
    await dispose(wiring);
  });

  it("reshapes oversized results through the registered listener", async () => {
    const wiring = await wire({ thresholds: { textBytes: 1_024 } });
    const listener = wiring.surface.listeners[0]!;
    expect(listener).toBeDefined();
    const accept = { kind: "accept" } as const;
    const decision = await listener(
      {
        callId: "c1",
        rootCallId: "c1",
        name: "bash",
        arguments: {},
        token: Symbol("t"),
        signal: new AbortController().signal,
      } as never,
      { isError: false, value: { stdout: makeText(4_096) }, content: [] } as never,
      async () => accept,
    );
    expect((decision as { content?: { text: string }[] }).content?.[0]?.text).toContain("[dsh-cas-results:");
    await dispose(wiring);
  });
});

describe("CasResultsService lifecycle", () => {
  it("starts a GC timer when enabled and clears it on dispose", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-cas-service-lifecycle-"));
    try {
      const ctx = new Context();
      const service = new CasResultsService(
        ctx,
        { gc: { enabled: true, intervalMs: 3_600_000 } } as CasResultsConfig,
        { storeRoot: root, logger: silentPluginLogger() },
      );
      const timer = (service as unknown as { gcTimer: NodeJS.Timeout | undefined }).gcTimer;
      expect(timer).toBeDefined();
      (service as unknown as { dispose(): void }).dispose();
      expect((service as unknown as { gcTimer: NodeJS.Timeout | undefined }).gcTimer).toBeUndefined();
      // Dispose is idempotent.
      (service as unknown as { dispose(): void }).dispose();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
