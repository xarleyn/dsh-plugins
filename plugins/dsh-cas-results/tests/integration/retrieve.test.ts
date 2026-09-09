/**
 * Integration tests for the `dsh_cas_*` retrieval tools (SPEC §20; AC2, AC6).
 */

import { afterEach, describe, expect, it } from "vitest";

import { createInfoTool } from "../../src/tools/info.js";
import { createRetrieveTool } from "../../src/tools/retrieve.js";
import { createSearchTool } from "../../src/tools/search.js";
import { createStatsTool } from "../../src/tools/stats.js";
import { createGcTool } from "../../src/tools/gc.js";
import { resolveCasResultsConfig } from "../../src/config.js";
import { CasCounters } from "../../src/observability/counters.js";
import { FilesystemCasStore } from "../../src/cas/filesystem-store.js";
import { sha256Hex } from "../../src/cas/hash.js";
import { buildStore, cleanupTempRoots, makeText, tempRoot, TINY_PNG_BYTES } from "../fixtures/store-fixtures.js";

const encoder = new TextEncoder();

afterEach(async () => {
  await cleanupTempRoots();
});

interface Deps {
  store: FilesystemCasStore;
  counters: CasCounters;
  retrieve: ReturnType<typeof createRetrieveTool>;
  search: ReturnType<typeof createSearchTool>;
  info: ReturnType<typeof createInfoTool>;
  stats: ReturnType<typeof createStatsTool>;
  gc: ReturnType<typeof createGcTool>;
  readConfig: () => ReturnType<typeof resolveCasResultsConfig>;
}

async function deps(): Promise<Deps> {
  const store = buildStore(await tempRoot());
  const counters = new CasCounters();
  const config = resolveCasResultsConfig({ retrieval: { defaultBytes: 32_768, maxBytes: 65_536 } });
  const readConfig = () => config;
  return {
    store,
    counters,
    readConfig,
    retrieve: createRetrieveTool({ store, counters, readConfig }),
    search: createSearchTool({ store, counters }),
    info: createInfoTool({ store }),
    stats: createStatsTool({ store, counters }),
    gc: createGcTool({ store, readConfig }),
  };
}

function execute(tool: { execute(args: unknown, exec: unknown): Promise<unknown> }, args: unknown): Promise<unknown> {
  return tool.execute(args, {});
}

describe("dsh_cas_retrieve", () => {
  it("returns byte-identical content for text payloads (SPEC AC2)", async () => {
    const d = await deps();
    const original = `CRLF ✓ 中文\r\n${makeText(50_000)}`;
    const payload = encoder.encode(original);
    const object = await d.store.put({ payload, kind: "text", mediaType: "text/plain", encoding: "utf8" });
    const outcome = await execute(d.retrieve, { ref: object.ref }) as { content: string; totalBytes: number; truncated: boolean };
    expect(outcome.truncated).toBe(true);
    expect(outcome.totalBytes).toBe(payload.length);
    // The first chunk equals the original prefix; joined chunks reproduce
    // the payload byte-for-byte.
    expect(original.startsWith(outcome.content)).toBe(true);
    const rest = await execute(d.retrieve, { ref: object.ref, offset: Buffer.byteLength(outcome.content, "utf8") }) as { content: string };
    expect(outcome.content + rest.content).toBe(original);
  });

  it("paginates large payloads and reports the next offset", async () => {
    const d = await deps();
    const original = makeText(200_000);
    const object = await d.store.put({ payload: encoder.encode(original), kind: "log", mediaType: "text/log", encoding: "utf8" });
    const first = await execute(d.retrieve, { ref: object.ref }) as { offset: number; returnedBytes: number; truncated: boolean; encoding: string };
    expect(first.offset).toBe(0);
    expect(first.returnedBytes).toBe(32_768);
    expect(first.truncated).toBe(true);
    const second = await execute(d.retrieve, { ref: object.ref, offset: first.returnedBytes }) as { offset: number };
    expect(second.offset).toBe(32_768);
  });

  it("enforces the configured hard maximum regardless of the requested limit (SPEC AC6)", async () => {
    const d = await deps();
    const original = makeText(200_000);
    const object = await d.store.put({ payload: encoder.encode(original), kind: "log", mediaType: "text/log", encoding: "utf8" });
    const outcome = await execute(d.retrieve, { ref: object.ref, limit: 10_000_000 }) as { returnedBytes: number };
    expect(outcome.returnedBytes).toBe(65_536);
  });

  it("returns canonical base64 for binary payloads", async () => {
    const d = await deps();
    const object = await d.store.put({ payload: TINY_PNG_BYTES, kind: "binary", mediaType: "image/png", encoding: "binary" });
    const auto = await execute(d.retrieve, { ref: object.ref }) as { encoding: string; content: string };
    expect(auto.encoding).toBe("base64");
    expect(Buffer.from(auto.content, "base64").equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
    const hex = await execute(d.retrieve, { ref: object.ref, encoding: "hex" }) as { content: string };
    expect(hex.content.slice(0, 8)).toBe(Buffer.from(TINY_PNG_BYTES).toString("hex").slice(0, 8));
  });

  it("rejects malformed refs and missing objects with actionable messages (SPEC §24)", async () => {
    const d = await deps();
    await expect(execute(d.retrieve, { ref: "not-a-ref" })).rejects.toThrowError(/invalid CAS reference/);
    const missing = `sha256:${sha256Hex(encoder.encode("never stored"))}`;
    await expect(execute(d.retrieve, { ref: missing })).rejects.toThrowError(/no longer available/);
  });
});

describe("dsh_cas_search", () => {
  it("finds the middle error of a large log without reinjecting it (SPEC §30 Phase 3)", async () => {
    const d = await deps();
    const lines: string[] = [];
    for (let index = 0; index < 20_000; index += 1) {
      lines.push(index === 10_000 ? "AssertionError: expected 42 to equal 43" : `2026-08-30T18:00:00.000Z INFO line ${index}`);
    }
    const object = await d.store.put({ payload: encoder.encode(lines.join("\n")), kind: "log", mediaType: "text/log", encoding: "utf8" });
    const outcome = await execute(d.search, { ref: object.ref, query: "AssertionError", contextLines: 2 }) as {
      totalMatches: number;
      matches: { line: number; text: string; before: string[]; after: string[] }[];
    };
    expect(outcome.totalMatches).toBe(1);
    expect(outcome.matches[0]?.line).toBe(10_001);
    expect(outcome.matches[0]?.text).toContain("AssertionError");
    expect(outcome.matches[0]?.before).toHaveLength(2);
    expect(d.counters.snapshot().searchCalls).toBe(1);
  });

  it("requires a non-empty query", async () => {
    const d = await deps();
    await expect(execute(d.search, { ref: `sha256:${"a".repeat(64)}`, query: "" })).rejects.toThrowError(/query/);
  });
});

describe("dsh_cas_info and dsh_cas_stats", () => {
  it("reports metadata and aggregates", async () => {
    const d = await deps();
    const object = await d.store.put({ payload: encoder.encode(makeText(50_000)), kind: "text", mediaType: "text/plain", encoding: "utf8", firstTool: "bash" });
    const expectedSize = Buffer.byteLength(makeText(50_000), "utf8");
    const info = await execute(d.info, { ref: object.ref }) as { exists: boolean; size: number; firstTool: string; kind: string };
    expect(info.exists).toBe(true);
    expect(info.size).toBe(expectedSize);
    expect(info.firstTool).toBe("bash");
    expect(info.kind).toBe("text");

    const missing = await execute(d.info, { ref: `sha256:${"b".repeat(64)}` }) as { exists: boolean; message: string };
    expect(missing.exists).toBe(false);
    expect(missing.message).toContain("no longer available");

    const stats = await execute(d.stats, {}) as { objects: number; logicalBytes: number };
    expect(stats.objects).toBe(1);
    expect(stats.logicalBytes).toBe(expectedSize);
  });
});

describe("dsh_cas_gc", () => {
  it("runs a collection pass and reports the outcome", async () => {
    const d = await deps();
    const object = await d.store.put({ payload: encoder.encode("to be collected"), kind: "text", mediaType: "text/plain", encoding: "utf8" });
    await d.store.touch(object.ref.replace("sha256:", ""), new Date(Date.parse("2020-01-01T00:00:00.000Z")));
    const outcome = await execute(d.gc, {}) as { deletedObjects: number };
    expect(outcome.deletedObjects).toBe(1);
  });
});
