/**
 * Integration tests for the tools/post-execute interception seam
 * (SPEC §8, §26-§27; AC1, AC7, AC8, AC9).
 */

import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPostExecuteListener } from "../../src/integration/post-execute.js";
import { resolveCasResultsConfig } from "../../src/config.js";
import type { ResolvedCasResultsConfig } from "../../src/config.js";
import { CasCounters } from "../../src/observability/counters.js";
import { FilesystemCasStore } from "../../src/cas/filesystem-store.js";
import { parseCasRef } from "../../src/cas/hash.js";
import { isCasMarkerText } from "../../src/transform/marker.js";
import { makeLog, makeText, silentPluginLogger, tempRoot, cleanupTempRoots } from "../fixtures/store-fixtures.js";
import type { CasStore } from "../../src/cas/types.js";
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

const accept: PostToolDecision = { kind: "accept" };

function fakeExec(name: string, overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name,
    arguments: {},
    token: Symbol("token") as ToolExecution["token"],
    signal: new AbortController().signal,
    ...overrides,
  } as ToolExecution;
}

function successResult(value: unknown): ToolExecutionResult {
  return { isError: false, value, content: [{ type: "text", text: JSON.stringify(value) }] } as ToolExecutionResult;
}

interface Harness {
  listener: ReturnType<typeof createPostExecuteListener>;
  store: FilesystemCasStore;
  counters: CasCounters;
  root: string;
  config: ResolvedCasResultsConfig;
}

async function harness(configOverrides: Partial<ResolvedCasResultsConfig> = {}, storeOverride?: CasStore): Promise<Harness> {
  const root = await tempRoot();
  const store = (storeOverride ?? new FilesystemCasStore(root, { compression: "none" })) as FilesystemCasStore;
  const counters = new CasCounters();
  const config = { ...resolveCasResultsConfig({ thresholds: { textBytes: 1_024, htmlBytes: 512, logBytes: 1_024 }, base64: { minChars: 128 } }), ...configOverrides };
  const listener = createPostExecuteListener({
    store,
    counters,
    readConfig: () => config,
    logger: silentPluginLogger(),
  });
  return { listener, store, counters, root, config };
}

afterEach(async () => {
  await cleanupTempRoots();
});

describe("post-execute interception (AC1)", () => {
  it("offloads a large successful result and replaces the model-facing content", async () => {
    const { listener, store } = await harness();
    const stdout = makeText(4_096);
    const decision = await listener(fakeExec("bash"), successResult({ stdout, stderr: "" }), async () => accept);

    expect(decision.kind).toBe("accept");
    const content = (decision as { content?: { type: string; text: string }[] }).content;
    expect(content).toHaveLength(1);
    const text = content?.[0]?.text ?? "";
    expect(isCasMarkerText(text.split("\n")[0] ?? "")).toBe(true);
    expect(text).toContain("dsh_cas_retrieve");
    // The original value survives untouched and its payload is in the store.
    const hash = /sha256:([a-f0-9]{64})/.exec(text)?.[1] ?? "";
    const read = await store.read(hash);
    expect(Buffer.from(read.bytes).toString()).toBe(stdout);
    expect((decision as { value?: unknown }).value).toBeUndefined();
  });

  it("leaves small results untouched", async () => {
    const { listener } = await harness();
    const decision = await listener(fakeExec("bash"), successResult({ stdout: "tiny" }), async () => accept);
    expect(decision).toEqual({ kind: "accept" });
  });

  it("is idempotent when the content is already a CAS marker (SPEC §27)", async () => {
    const { listener } = await harness();
    const marker = `[dsh-cas-results: 4096B log → 512B preview; sha256=${"a".repeat(64)}; use dsh_cas_retrieve]`;
    const decision = await listener(fakeExec("bash"), successResult({ stdout: marker }), async () => accept);
    expect(decision).toEqual({ kind: "accept" });
  });
});

describe("failure safety (SPEC §26, AC7)", () => {
  it("passes the original result through when the store is unwritable", async () => {
    const root = await tempRoot();
    const blocked = join(root, "occupied");
    await writeFile(blocked, "a file, not a directory");
    const brokenStore = new FilesystemCasStore(blocked, { compression: "none" });
    const { listener } = await harness({}, brokenStore);
    const value = { stdout: makeText(4_096) };
    const decision = await listener(fakeExec("bash"), successResult(value), async () => accept);
    expect(decision).toEqual({ kind: "accept" });
    expect((decision as { content?: unknown }).content).toBeUndefined();
  });

  it("propagates block decisions from downstream listeners", async () => {
    const { listener } = await harness();
    const blocked: PostToolDecision = { kind: "block", feedback: [{ type: "text", text: "denied" }] };
    const decision = await listener(fakeExec("bash"), successResult({ stdout: makeText(4_096) }), async () => blocked);
    expect(decision).toBe(blocked);
  });
});

describe("error results (SPEC AC8)", () => {
  it("never touches failed results by default", async () => {
    const { listener, counters } = await harness();
    const failure = {
      isError: true,
      error: { message: `boom ${makeText(4_096)}` },
      content: [{ type: "text", text: `Error: boom ${makeText(4_096)}` }],
    } as unknown as ToolExecutionResult;
    const decision = await listener(fakeExec("bash"), failure, async () => accept);
    expect(decision).toEqual({ kind: "accept" });
    expect(counters.snapshot().resultsScanned).toBe(0);
  });

  it("previews oversized error text when includeErrors is enabled", async () => {
    const { listener, store } = await harness({ includeErrors: true });
    const bigError = `Error: ${makeLog(4_096)}`;
    const failure = {
      isError: true,
      error: { message: "boom" },
      content: [{ type: "text", text: bigError }],
    } as unknown as ToolExecutionResult;
    const decision = await listener(fakeExec("bash"), failure, async () => accept);
    const text = (decision as { content?: { text: string }[] }).content?.[0]?.text ?? "";
    expect(text).toContain("[dsh-cas-results:");
    const hash = /sha256:([a-f0-9]{64})/.exec(text)?.[1] ?? "";
    expect(Buffer.from((await store.read(hash)).bytes).toString()).toBe(bigError);
  });
});

describe("recursion and scope protection (SPEC §21, AC9)", () => {
  it("never transforms its own retrieval tools", async () => {
    const { listener } = await harness();
    for (const name of ["dsh_cas_retrieve", "dsh_cas_search", "dsh_cas_info", "dsh_cas_stats", "dsh_cas_gc"]) {
      const decision = await listener(fakeExec(name), successResult({ content: makeText(40_000) }), async () => accept);
      expect(decision).toEqual({ kind: "accept" });
    }
  });

  it("ignores code-mode sub-dispatches (parent executions)", async () => {
    const { listener } = await harness();
    const decision = await listener(
      fakeExec("bash", { parent: Symbol("parent") as ToolExecution["parent"] }),
      successResult({ stdout: makeText(40_000) }),
      async () => accept,
    );
    expect(decision).toEqual({ kind: "accept" });
  });

  it("honors the enabled flag and per-tool exclusions", async () => {
    const disabled = await harness({ enabled: false });
    await expect(
      disabled.listener(fakeExec("bash"), successResult({ stdout: makeText(40_000) }), async () => accept),
    ).resolves.toEqual({ kind: "accept" });

    const excluded = await harness();
    const decision = await excluded.listener(
      fakeExec("edit"),
      successResult({ snippet: makeText(40_000) }),
      async () => accept,
    );
    expect(decision).toEqual({ kind: "accept" });
  });
});

describe("observability counters (SPEC §28)", () => {
  it("counts scans, stores, hits and preview bytes", async () => {
    const { listener, counters, store } = await harness();
    const payload = { stdout: makeLog(4_096) };
    const first = await listener(fakeExec("bash"), successResult(payload), async () => accept);
    const second = await listener(fakeExec("bash"), successResult(payload), async () => accept);
    expect(first.kind).toBe("accept");
    expect(second.kind).toBe("accept");
    const snapshot = counters.snapshot();
    expect(snapshot.resultsScanned).toBe(2);
    expect(snapshot.objectsStored).toBe(1);
    expect(snapshot.casHits).toBe(1);
    expect(snapshot.previewBytes).toBeGreaterThan(0);
    expect(snapshot.logicalBytesOffloaded).toBeGreaterThan(4_000);
    expect((await store.stats()).objects).toBe(1);
  });
});

describe("marker roundtrip", () => {
  it("lets the model retrieve the exact original after offload (SPEC AC2)", async () => {
    const { listener, store } = await harness();
    const original = `unicode ✓ 中文\r\n${makeText(4_096)}`;
    const decision = await listener(fakeExec("bash"), successResult({ stdout: original }), async () => accept);
    const text = (decision as { content?: { text: string }[] }).content?.[0]?.text ?? "";
    const ref = `sha256:${/sha256:([a-f0-9]{64})/.exec(text)?.[1] ?? ""}`;
    const read = await store.read(parseCasRef(ref));
    expect(Buffer.from(read.bytes).toString("utf8")).toBe(original);
  });
});
