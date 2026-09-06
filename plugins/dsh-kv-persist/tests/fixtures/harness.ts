/**
 * Coordinator test harness: temp metadata root, fake backend, silent logger.
 * No network and no llama-server involved (SPEC §77).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKvPersistConfig } from "../../src/config.js";
import type { KvPersistConfig, ResolvedKvPersistConfig } from "../../src/config.js";
import { SingleSlotCoordinator } from "../../src/coordinator/coordinator.js";
import type { CoordinatorRequest } from "../../src/coordinator/coordinator.js";
import type { KvPersistLogger } from "../../src/observability/diagnostics.js";
import { KvPersistMetrics } from "../../src/observability/metrics.js";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { SnapshotRepository } from "../../src/snapshots/repository.js";
import { buildSnapshotIdentity } from "../../src/snapshots/fingerprint.js";
import type { SnapshotIdentity } from "../../src/snapshots/fingerprint.js";
import { snapshotFilename } from "../../src/snapshots/naming.js";
import { FakeKvBackend } from "./fake-backend.js";

export const silentLogger: KvPersistLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export interface Harness {
  root: string;
  config: ResolvedKvPersistConfig;
  backend: FakeKvBackend;
  repository: SnapshotRepository;
  metrics: KvPersistMetrics;
  coordinator: SingleSlotCoordinator;
  cleanup(): Promise<void>;
}

export async function createHarness(
  configOverrides: KvPersistConfig = {},
  backend = new FakeKvBackend(),
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "dsh-kv-persist-test-"));
  const config = resolveKvPersistConfig({
    providers: ["local-qwen"],
    backend: { baseURL: "http://127.0.0.1:8080", requestTimeoutMs: 5_000 },
    metadata: { path: root },
    ...configOverrides,
  });
  const repository = new SnapshotRepository(root);
  const metrics = new KvPersistMetrics();
  const coordinator = new SingleSlotCoordinator({
    config,
    backend,
    repository,
    metrics,
    logger: silentLogger,
  });
  return {
    root,
    config,
    backend,
    repository,
    metrics,
    coordinator,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Build a coordinated request whose stream emits a delta + successful finish. */
export function makeRequest(options: {
  sessionId: string | null;
  provider?: string;
  model?: string;
  purpose?: string;
  onStreamOpened?: () => void;
}): CoordinatorRequest {
  return {
    sessionId: options.sessionId,
    provider: options.provider ?? "local-qwen",
    model: options.model ?? "qwen-test",
    purpose: options.purpose,
    next: async function* (): AsyncIterable<StreamChunk> {
      options.onStreamOpened?.();
      yield { type: "text-delta", index: 0, text: "hello" };
      yield { type: "finish", reason: { kind: "stop" } };
    },
  };
}

/** Drain a coordinated stream, collecting the chunks. */
export async function consume(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function buildIdentity(harness: Harness, sessionId: string): SnapshotIdentity {
  return buildSnapshotIdentity({
    sessionId,
    route: { provider: "local-qwen", model: "qwen-test" },
    baseURL: harness.config.baseURL,
    runtimeKey: harness.config.runtimeKey,
  });
}

export function residentKey(harness: Harness, sessionId: string): string {
  return snapshotFilename(buildIdentity(harness, sessionId));
}

export async function run(harness: Harness, sessionId: string, provider = "local-qwen") {
  const stream = await harness.coordinator.runSessionRequest(
    makeRequest({ sessionId, provider }),
  );
  return consume(stream);
}
