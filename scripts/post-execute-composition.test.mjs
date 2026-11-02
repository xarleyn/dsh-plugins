/** Cross-package composition through built public exports; run after plugin builds. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { createMessage } from "@deepseek-ai/dsh-llm";

// This Node test process owns its environment; imported plugin loggers must
// not write into the operator's profile during a synthetic integration check.
process.env.NODE_ENV = "test";
const cas = await import("@yadsh/dsh-cas-results");
const offload = await import("@yadsh/dsh-tool-offload");
const { JevCompactionService } = await import("@yadsh/dsh-jev-compaction");

const log = [
  "installing dependencies",
  ...Array.from(
    { length: 500 },
    (_, index) => `progress ${index}% of dependency graph`,
  ),
  "80 passed, 1 failed",
].join("\n");

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function listeners(t) {
  const root = await mkdtemp(join(tmpdir(), "dsh-result-composition-"));
  const ctx = new Context();
  let service;
  t.after(async () => {
    service?.dispose();
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  // JEV's public service registers its real listener. Capture that registration
  // while keeping Cordis ownership and unsubscription in the integration.
  let jev;
  const register = ctx.on.bind(ctx);
  ctx.on = (...args) => {
    if (args[0] === "tools/post-execute") jev = args[1];
    return register(...args);
  };
  ctx.provide("tokenMeter", {
    measure() {
      throw new Error("Historical compaction is outside this fixture.");
    },
  });
  service = new JevCompactionService(
    ctx,
    {
      decision: { typesafe: { apiKeyEnv: "" } },
      resultShaping: { enabled: true, includeTools: ["read"] },
      archive: { rootPath: join(root, "archive") },
    },
    {
      score: async (_state, questions) =>
        new Map(
          questions.map((question) => [
            question.name,
            question.name.startsWith("routine_") ? 0.95 : 0.05,
          ]),
        ),
    },
  );
  assert.equal(
    typeof jev,
    "function",
    "public service registers result shaping",
  );

  return {
    jev,
    cas: cas.createPostExecuteListener({
      store: new cas.FilesystemCasStore(join(root, "cas"), {
        compression: "none",
      }),
      counters: new cas.CasCounters(),
      logger,
      readConfig: () =>
        cas.resolveCasResultsConfig({
          thresholds: { textBytes: 4096, htmlBytes: 4096, logBytes: 4096 },
          preview: { maxChars: 512 },
        }),
    }),
    offload: offload.createPostExecuteListener({
      runner: {
        run: async () => ({
          kind: "completed",
          outputText: "compact answer",
          stopReason: "completed",
        }),
      },
      counters: new offload.OffloadCounters(),
      logger,
      readConfig: () =>
        offload.resolveToolOffloadConfig({
          routing: { thresholds: { minBytes: 4096, minEstimatedTokens: 1024 } },
        }),
      globalGate: new offload.Semaphore(2),
      agentGate: new offload.KeyedLimiter(2),
    }),
  };
}

for (const [outerName, innerName] of [
  ["cas", "jev"],
  ["jev", "cas"],
  ["offload", "jev"],
  ["jev", "offload"],
  ["cas", "offload"],
  ["offload", "cas"],
]) {
  test(`${outerName} wraps ${innerName} without restoring the original result`, async (t) => {
    const processors = await listeners(t);
    const exec = {
      name: "read",
      callId: "synthetic-call",
      rootCallId: "synthetic-call",
      arguments: {},
      token: Symbol("synthetic-execution"),
      signal: new globalThis.AbortController().signal,
      agent: {
        session: {
          id: "synthetic-session",
          header: { id: "synthetic-session" },
          events: [],
          snapshotEvents: () => [],
        },
      },
    };
    const result = {
      isError: false,
      value: { stdout: log, exitCode: 1 },
      content: [{ type: "text", text: log }],
    };
    const contexts = [
      createMessage({
        role: "user",
        content: [{ type: "text", text: "Synthetic review context" }],
        source: { kind: "user" },
      }),
    ];
    let inner;
    const decision = await processors[outerName](exec, result, async () => {
      inner = await processors[innerName](exec, result, async () => ({
        kind: "accept",
        additionalContexts: contexts,
      }));
      return inner;
    });
    assert.equal(inner.kind, "accept");
    assert.equal(decision.kind, "accept");
    assert.ok(inner.content, "the inner processor produced a projection");
    assert.ok(
      !JSON.stringify(inner.content).includes(
        "progress 350% of dependency graph",
      ),
    );
    assert.deepEqual(decision.content, inner.content);
    assert.equal(decision.additionalContexts, contexts);
  });
}
