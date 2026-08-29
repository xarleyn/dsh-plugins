import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import { KvPersistService } from "../../src/service.js";
import { resolveKvPersistConfig } from "../../src/config.js";
import type { KvPersistConfig } from "../../src/config.js";
import { silentLogger } from "../fixtures/harness.js";
import { FakeKvBackend } from "../fixtures/fake-backend.js";

const roots: string[] = [];

async function tempConfig(overrides: KvPersistConfig = {}): Promise<KvPersistConfig> {
  const root = await mkdtemp(join(tmpdir(), "dsh-kv-persist-service-"));
  roots.push(root);
  return {
    providers: ["local-qwen"],
    metadata: { path: root },
    ...overrides,
  };
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

function buildService(config: KvPersistConfig, backend = new FakeKvBackend()): KvPersistService {
  const ctx = new Context();
  return new KvPersistService(ctx, config, { backend, logger: silentLogger });
}

describe("KvPersistService (SPEC §11, §37, §47)", () => {
  it("registers as ctx.kvPersist", async () => {
    const ctx = new Context();
    const service = new KvPersistService(ctx, await tempConfig(), {
      backend: new FakeKvBackend(),
      logger: silentLogger,
    });
    // The host may expose the service through an accessor proxy; the
    // contract is that the public surface is reachable on the context.
    expect(ctx.kvPersist).toBeDefined();
    expect(ctx.kvPersist.handles).toBeTypeOf("function");
    expect(ctx.kvPersist.resolvedConfig.enabled).toBe(service.resolvedConfig.enabled);
  });

  it("coordinates only explicitly managed providers (SPEC §37)", async () => {
    const service = buildService(await tempConfig({ providers: ["local-qwen"] }));
    expect(service.handles("local-qwen")).toBe(true);
    expect(service.handles("deepseek")).toBe(false);
    expect(service.handles("openai")).toBe(false);
    expect(service.handles("anthropic")).toBe(false);
  });

  it("coordinates nothing when disabled", async () => {
    const service = buildService(await tempConfig({ enabled: false }));
    expect(service.handles("local-qwen")).toBe(false);
  });

  it("reports a status snapshot (SPEC §47)", async () => {
    const service = buildService(await tempConfig());
    const status = await service.status();
    expect(status.enabled).toBe(true);
    expect(status.backend).toEqual({
      kind: "llama.cpp",
      state: "healthy",
      endpoint: "http://127.0.0.1:8080",
    });
    expect(status.mode).toBe("single-slot");
    expect(status.slots).toEqual([{ id: 0, owner: null, state: "unknown" }]);
    expect(status.snapshots).toEqual({ known: 0, valid: 0, invalid: 0 });
    expect(status.stats).toEqual({ restores: 0, restoreHits: 0, coldStarts: 0, saves: 0 });
  });

  it("returns undefined for unknown session state", async () => {
    const service = buildService(await tempConfig());
    expect(service.getSessionState("missing")).toBeUndefined();
  });

  it("rejects unsupported backend types (SPEC §12)", async () => {
    const config = await tempConfig();
    expect(() =>
      resolveKvPersistConfig({
        ...config,
        backend: { type: "vllm" },
      } as unknown as KvPersistConfig),
    ).toThrowError();
  });

  it("doctor reports blocked health when the backend is unavailable (§34, §48)", async () => {
    const backend = new FakeKvBackend();
    backend.setUnavailable(true);
    const service = buildService(await tempConfig(), backend);
    const report = await service.doctor();
    expect(report.result).toBe("BLOCKED");
    expect(report.checks.find((check) => check.name === "slots-api")?.ok).toBe(false);
  });

  it("doctor reports READY against a healthy fake backend", async () => {
    const service = buildService(await tempConfig());
    const report = await service.doctor();
    expect(report.result).toBe("READY");
  });
});
