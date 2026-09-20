/**
 * Persistence and hand-off to historical compaction (result-shaping SPEC §55,
 * §26, §65).
 *
 * This is the case the plugin's safety note is about: immediate shaping runs
 * *before* DSH persists the result, so what replay sees is the shaped content
 * and the original exists only in the plugin archive. The test follows the
 * whole path — shape, persist, replay, archive, then historical compaction.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMessage,
  createToolResultMessage,
  ToolCallId,
} from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import type { Session as DshSession } from "@deepseek-ai/dsh-session";

import { LocalResultArchive } from "../../src/archive/local.js";
import { contentRef } from "../../src/archive/hash.js";
import {
  DEFAULT_SHAPE_TOOLS,
  resolveJevCompactionConfig,
} from "../../src/config.js";
import type { ResolvedJevCompactionConfig } from "../../src/config.js";
import type {
  JevAnswers,
  JevQuestion,
  SystemOneBackend,
} from "../../src/jev/types.js";
import { TurnShapeBudget } from "../../src/result-shaping/budget.js";
import { createPostExecuteListener } from "../../src/result-shaping/hook.js";
import { ShapingMetrics } from "../../src/result-shaping/metrics.js";
import { ImmediateResultShaper } from "../../src/result-shaping/shaper.js";
import { collectCandidates } from "../../src/planner/collect.js";
import { extractFeatures } from "../../src/planner/features.js";
import { renderStub } from "../../src/mutation/render.js";

const PROGRESS_LOG = [
  "installing dependencies",
  ...Array.from(
    { length: 300 },
    (_, index) => `progress ${index + 1}% of dependency graph`,
  ),
  ...Array.from(
    { length: 100 },
    (_, index) => `fetching metadata for pkg-${index}`,
  ),
  "added 42 packages in 3s",
  "80 passed, 1 failed",
].join("\n");

class RoutineBackend implements SystemOneBackend {
  async score(
    _state: unknown,
    questions: readonly JevQuestion[],
  ): Promise<JevAnswers> {
    const answers: JevAnswers = new Map();
    for (const question of questions) {
      answers.set(
        question.name,
        question.name.startsWith("routine_") ? 0.97 : 0.02,
      );
    }
    return answers;
  }
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jev-persist-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Append one closed tool step whose result is `content`. */
function appendStep(
  session: DshSession,
  turn: number,
  call: string,
  content: { type: "text"; text: string }[],
): number {
  const callId = ToolCallId(call);
  session.append("turn/start", { turn });
  session.append("step/start", { turn, step: 1 });
  session.append(
    "assistant/message",
    {
      stream: [],
      turn,
      step: 1,
      message: createMessage({
        role: "assistant",
        content: [
          { type: "tool-call", id: callId, name: "bash", arguments: "{}" },
        ],
        source: { kind: "model", provider: "test-model", model: "test-model" },
      }),
    },
    { surfaceOp: "append" },
  );
  session.append("tool/call", {
    turn,
    step: 1,
    callId,
    name: "bash",
    arguments: JSON.stringify({ command: "npm test" }),
  });
  const result = session.append(
    "tool/result",
    {
      turn,
      step: 1,
      message: createToolResultMessage({ callId, content, isError: false }),
    },
    { surfaceOp: "append" },
  );
  session.append("step/end", { turn, step: 1 });
  session.append("turn/end", { turn, reason: { kind: "completed" } });
  return result.seq;
}

describe("a shaped result survives persistence and replay", () => {
  it("persists the shaped content, keeps the original in the archive, and hands over to historical compaction", async () => {
    const archive = new LocalResultArchive(root);
    const config: ResolvedJevCompactionConfig = resolveJevCompactionConfig({
      resultShaping: { enabled: true, includeTools: [...DEFAULT_SHAPE_TOOLS] },
      archive: { rootPath: root },
      preserve: { recentMessages: 0, recentTokens: 0 },
    });
    const metrics = new ShapingMetrics();
    const shaper = new ImmediateResultShaper({
      readConfig: () => config,
      backend: new RoutineBackend(),
      archive,
      metrics,
      onSkip: () => undefined,
      onShaped: () => undefined,
    });
    const budget = new TurnShapeBudget();
    const listener = createPostExecuteListener({
      shaper,
      readConfig: () => config,
      reserveBudget: (_exec, chars) =>
        budget.tryConsume("session-persist", 1, chars, config),
      goalFor: () => "run the test suite",
      onSkip: () => undefined,
    });

    const session = Session.create(SessionId("session-persist"));
    const sessionLike = {
      header: { id: "session-persist" },
      snapshotEvents: () => session.snapshotEvents(),
    };

    // 1-3: execute, capture the rendered content, archive the original.
    const decision = (await listener(
      {
        callId: "call-1",
        rootCallId: "call-1",
        name: "bash",
        arguments: { command: "npm test" },
        agent: { session: sessionLike },
        signal: new AbortController().signal,
        token: {},
      } as never,
      {
        isError: false,
        value: { ok: true },
        content: [{ type: "text", text: PROGRESS_LOG }],
      } as never,
      () => Promise.resolve({ kind: "accept" }),
    )) as { content: { type: "text"; text: string }[] };

    // 4: the shaped result is what the durable event carries.
    expect(decision.content[0]!.text).toContain(
      "[dsh-jev-compaction: collapsed",
    );
    appendStep(session, 1, "call-1", decision.content);
    // A later turn makes the shaped result historical rather than current.
    appendStep(session, 2, "call-2", [{ type: "text", text: "later output" }]);
    session.append("turn/start", { turn: 3 });

    // 5-6: replay sees the shaped content, not the original.
    const replayed = session
      .snapshotEvents()
      .find((event) => event.type === "tool/result");
    expect(replayed).toBeDefined();
    const replayedText = (
      replayed!.data as {
        message: { content: [{ content: { text: string }[] }] };
      }
    ).message.content[0].content
      .map((block) => block.text)
      .join("\n");
    expect(replayedText).toContain("[dsh-jev-compaction: collapsed");
    expect(replayedText).not.toContain("progress 60% of dependency graph");

    // 7-8: the archive still holds the original, and its hash matches.
    const ref = /original archived as (sha256:[0-9a-f]+)/u.exec(
      replayedText,
    )![1]!;
    const stored = await archive.list();
    expect(stored).toHaveLength(1);
    const full = await archive.get(stored[0]!.ref);
    expect(full).not.toBeNull();
    expect(full!.content).toEqual([{ type: "text", text: PROGRESS_LOG }]);
    expect(full!.contentHash.startsWith(ref)).toBe(true);
    expect(contentRef(full!.content)).toBe(full!.contentHash);
    expect(full!.charCount).toBe(Array.from(PROGRESS_LOG).length);

    // 9: historical compaction recognizes the shaped node and may still stub
    // it, carrying the archive reference forward.
    const collected = collectCandidates(session, config);
    expect(collected.candidates.length).toBeGreaterThan(0);
    const candidate = collected.candidates.find(
      (item) => item.callId === "call-1",
    );
    expect(candidate).toBeDefined();
    expect(candidate!.alreadyShaped).toBe(true);
    expect(candidate!.archiveRef).toBe(ref);
    const features = extractFeatures(collected.candidates, collected.callIndex);
    expect(features.get(candidate!.callId)?.alreadyShaped).toBe(true);
    const stub = renderStub(candidate!, "low semantic retention score");
    expect(stub).toContain("previouslyShaped=true");
    expect(stub).toContain(`archivedOriginal=${ref}`);
    expect(stub).toContain("[dsh-jev-compaction]");
  });

  it("is explicit that a shaped result without an archive is not recoverable", async () => {
    const config: ResolvedJevCompactionConfig = resolveJevCompactionConfig({
      resultShaping: { enabled: true, includeTools: [...DEFAULT_SHAPE_TOOLS] },
      archive: { enabled: false },
    });
    const shaper = new ImmediateResultShaper({
      readConfig: () => config,
      backend: new RoutineBackend(),
      // The archive is never consulted once it is disabled.
      archive: new LocalResultArchive(root),
      metrics: new ShapingMetrics(),
      onSkip: () => undefined,
      onShaped: () => undefined,
    });
    const outcome = await shaper.maybeShape({
      callId: "call-1",
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text: PROGRESS_LOG }],
      goal: "goal",
    });
    expect(outcome).toBeDefined();
    const shaped = outcome!.content[0]!.text as string;
    expect(shaped).toContain("collapsed");
    // No reference is claimed, so nothing implies the original is retrievable.
    expect(shaped).not.toContain("archived as");
    expect(await new LocalResultArchive(root).list()).toHaveLength(0);
  });
});
