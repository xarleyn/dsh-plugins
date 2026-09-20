/**
 * Middleware interoperability (result-shaping SPEC §54, §63).
 *
 * The shaper is an outer post-processor: it runs *after* the rest of the
 * chain and only ever replaces `content`. These fixtures pin the four
 * composition cases and the cancellation path, because each of them is a way
 * for a post-execute plugin to break its neighbours.
 */

import { describe, expect, it } from "vitest";

import type {
  ArchivedToolResult,
  OriginalResultArchive,
} from "../../src/archive/types.js";
import { resolveJevCompactionConfig } from "../../src/config.js";
import { DEFAULT_SHAPE_TOOLS } from "../../src/config.js";
import type { ResolvedJevCompactionConfig } from "../../src/config.js";
import type {
  JevAnswers,
  JevQuestion,
  SystemOneBackend,
} from "../../src/jev/types.js";
import { TurnShapeBudget } from "../../src/result-shaping/budget.js";
import { createPostExecuteListener } from "../../src/result-shaping/hook.js";
import type { PostExecuteListener } from "../../src/result-shaping/hook.js";
import type { ShapeSkipReason } from "../../src/result-shaping/metrics.js";
import { ShapingMetrics } from "../../src/result-shaping/metrics.js";
import { ImmediateResultShaper } from "../../src/result-shaping/shaper.js";
import type { PostToolDecision } from "@deepseek-ai/dsh-tools";

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
  public calls = 0;

  constructor(private readonly answer = 0.95) {}

  async score(
    _state: unknown,
    questions: readonly JevQuestion[],
  ): Promise<JevAnswers> {
    this.calls += 1;
    const answers: JevAnswers = new Map();
    for (const question of questions) {
      answers.set(
        question.name,
        question.name.startsWith("routine_") ? this.answer : 1 - this.answer,
      );
    }
    return answers;
  }
}

class NullArchive implements OriginalResultArchive {
  public readonly entries: ArchivedToolResult[] = [];

  async put(entry: ArchivedToolResult): Promise<string> {
    this.entries.push(entry);
    return entry.contentHash;
  }

  async get(): Promise<ArchivedToolResult | null> {
    return null;
  }
}

interface HarnessOptions {
  readonly backend?: SystemOneBackend;
  readonly raw?: Parameters<typeof resolveJevCompactionConfig>[0];
  readonly goal?: string;
}

function buildHarness(options: HarnessOptions = {}) {
  const inner = options.backend ?? new RoutineBackend();
  let calls = 0;
  const backend: SystemOneBackend = {
    score: (state, questions, signal) => {
      calls += 1;
      return inner.score(state, questions, signal);
    },
  };
  const resolved: ResolvedJevCompactionConfig = resolveJevCompactionConfig({
    ...options.raw,
    resultShaping: {
      enabled: true,
      includeTools: [...DEFAULT_SHAPE_TOOLS],
      ...options.raw?.resultShaping,
    },
  });
  const metrics = new ShapingMetrics();
  const skips: ShapeSkipReason[] = [];
  const archive = new NullArchive();
  const shaper = new ImmediateResultShaper({
    readConfig: () => resolved,
    backend,
    archive,
    metrics,
    onSkip: (reason) => {
      skips.push(reason);
    },
    onShaped: () => undefined,
  });
  const budget = new TurnShapeBudget();
  const listener: PostExecuteListener = createPostExecuteListener({
    shaper,
    readConfig: () => resolved,
    reserveBudget: (exec, chars) => {
      const session = (exec as unknown as { agent?: { session?: unknown } })
        .agent?.session;
      return budget.tryConsume(
        "session-1",
        session === undefined ? undefined : 4,
        chars,
        resolved,
      );
    },
    goalFor: () => options.goal ?? "run the test suite",
    onSkip: (reason) => {
      skips.push(reason);
    },
  });
  return { listener, calls: () => calls, metrics, skips, archive, resolved };
}

const SESSION = {
  header: { id: "session-1" },
  snapshotEvents: () => [{ data: { turn: 4 } }],
};

function exec(overrides: Record<string, unknown> = {}) {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name: "bash",
    arguments: { command: "npm test" },
    agent: { session: SESSION },
    signal: new AbortController().signal,
    token: {},
    ...overrides,
  } as never;
}

function result(content: unknown[], isError = false) {
  return {
    isError,
    content,
    ...(isError ? { error: { message: "boom" } } : { value: { ok: true } }),
  } as never;
}

function textOf(content: unknown): string {
  const blocks = content as { type: string; text?: string }[];
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

describe("tools/post-execute composition", () => {
  it("shapes the result when the downstream chain accepts unchanged", async () => {
    const { listener } = buildHarness();
    const decision = await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve({ kind: "accept" }),
    );
    expect(decision.kind).toBe("accept");
    const shaped = textOf((decision as { content: unknown }).content);
    expect(shaped).toContain("[dsh-jev-compaction: collapsed");
    expect(shaped).not.toContain("progress 60% of dependency graph");
  });

  it("shapes the content the downstream chain replaced, not the stale original", async () => {
    const { listener } = buildHarness();
    const decision = await listener(
      exec(),
      result([{ type: "text", text: "small original" }]),
      () =>
        Promise.resolve({
          kind: "accept",
          content: [{ type: "text", text: PROGRESS_LOG }],
        }),
    );
    const shaped = textOf((decision as { content: unknown }).content);
    expect(shaped).not.toBe(PROGRESS_LOG);
    expect(shaped).toContain("[dsh-jev-compaction: collapsed");
  });

  it("never touches a decision that replaced the canonical value", async () => {
    const { listener, calls } = buildHarness();
    const downstream = {
      kind: "accept" as const,
      value: { rewritten: true },
    };
    const decision = await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve(downstream),
    );
    expect(decision).toEqual(downstream);
    expect(calls()).toBe(0);
  });

  it("preserves a downstream block exactly", async () => {
    const { listener, calls } = buildHarness();
    const downstream = {
      kind: "block" as const,
      feedback: [{ type: "text" as const, text: "denied by policy" }],
    };
    const decision = await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve(downstream),
    );
    expect(decision).toBe(downstream);
    expect(calls()).toBe(0);
  });

  it("keeps additionalContexts the downstream decision carried", async () => {
    const { listener } = buildHarness();
    const context = [
      { role: "user", content: [{ type: "text", text: "note" }] },
    ];
    const decision = (await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () =>
        Promise.resolve({
          kind: "accept",
          additionalContexts: context,
        } as PostToolDecision),
    )) as { additionalContexts?: unknown };
    expect(decision.additionalContexts).toBe(context);
  });

  it("skips nested code-mode dispatches the model never sees", async () => {
    const { listener, calls } = buildHarness();
    const decision = await listener(
      exec({ parent: { token: "parent" } }),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve({ kind: "accept" }),
    );
    expect(decision).toEqual({ kind: "accept" });
    expect(calls()).toBe(0);
  });

  it("produces no shaped result when the call is cancelled mid-request", async () => {
    const controller = new AbortController();
    const backend: SystemOneBackend = {
      score: async (_state, _questions, signal) => {
        controller.abort(new Error("turn cancelled"));
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (signal?.aborted === true) throw new Error("aborted");
        return new Map();
      },
    };
    const { listener } = buildHarness({ backend });
    const decision = (await listener(
      exec({ signal: controller.signal }),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve({ kind: "accept" }),
    )) as { content?: unknown };
    // The downstream decision stands, untouched: cancellation stays DSH-owned.
    expect(decision.content).toBeUndefined();
  });

  it("caps how many results one turn may shape", async () => {
    const { listener, calls } = buildHarness({
      raw: { resultShaping: { maxPerTurn: 1 } },
    });
    const next = () => Promise.resolve({ kind: "accept" } as const);
    const first = (await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      next,
    )) as { content?: unknown };
    const second = (await listener(
      exec({ callId: "call-2" }),
      result([{ type: "text", text: PROGRESS_LOG }]),
      next,
    )) as { content?: unknown };
    expect(first.content).toBeDefined();
    expect(second.content).toBeUndefined();
    expect(calls()).toBe(1);
  });

  it("does not spend the turn's budget on a result it never had to classify", async () => {
    const { listener, calls } = buildHarness({
      raw: { resultShaping: { maxPerTurn: 1 } },
    });
    const next = () => Promise.resolve({ kind: "accept" } as const);
    // Two results that are far too small: neither may consume the single
    // request this turn is allowed.
    await listener(exec(), result([{ type: "text", text: "tiny" }]), next);
    await listener(
      exec({ callId: "call-2" }),
      result([{ type: "text", text: "also tiny" }]),
      next,
    );
    expect(calls()).toBe(0);
    // The allowance is still intact for the result that needs it.
    const third = (await listener(
      exec({ callId: "call-3" }),
      result([{ type: "text", text: PROGRESS_LOG }]),
      next,
    )) as { content?: unknown };
    expect(third.content).toBeDefined();
    expect(calls()).toBe(1);
  });

  it("is inert while the feature is disabled", async () => {
    const { listener, calls } = buildHarness({
      raw: { resultShaping: { enabled: false } },
    });
    const decision = (await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve({ kind: "accept" }),
    )) as { content?: unknown };
    expect(decision.content).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it("never turns a successful call into a failure", async () => {
    const backend: SystemOneBackend = {
      score: () => {
        throw new Error("unexpected explosion");
      },
    };
    const { listener, skips } = buildHarness({ backend });
    const decision = await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }]),
      () => Promise.resolve({ kind: "accept" }),
    );
    expect(decision).toEqual({ kind: "accept" });
    expect(skips).toContain("jev-error");
  });

  it("leaves a failed tool result untouched", async () => {
    const { listener, calls } = buildHarness();
    const decision = (await listener(
      exec(),
      result([{ type: "text", text: PROGRESS_LOG }], true),
      () => Promise.resolve({ kind: "accept" }),
    )) as { content?: unknown };
    expect(decision.content).toBeUndefined();
    expect(calls()).toBe(0);
  });
});
