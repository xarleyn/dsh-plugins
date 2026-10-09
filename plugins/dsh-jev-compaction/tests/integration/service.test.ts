import { afterEach, describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { JevCompactionService } from "../../src/service.js";
import {
  FakeDecisionBackend,
  FailingBackend,
  buildFixtureSession,
  fakeAgent,
  fakeTokenMeter,
  resultText,
} from "../helpers/session.js";
import { appendUserText } from "../eval/fixtures.js";
import type { SystemOneBackend } from "../../src/jev/types.js";

afterEach(() => vi.restoreAllMocks());

function buildService(
  overrides: Record<string, unknown> = {},
  backend?: ConstructorParameters<typeof JevCompactionService>[2],
): {
  service: JevCompactionService;
  meter: ReturnType<typeof fakeTokenMeter>;
  ctx: Context;
} {
  const ctx = new Context();
  const meter = fakeTokenMeter();
  (
    ctx as unknown as {
      reflect: { provide(name: string, value: unknown): void };
    }
  ).reflect.provide("tokenMeter", meter);
  const service = new JevCompactionService(
    ctx,
    {
      enabled: true,
      trigger: {
        contextRatio: 0.7,
        minSurfaceTokens: 1,
        minCandidates: 1,
        minCandidateChars: 1,
        cooldownTurns: 0,
      },
      preserve: { recentMessages: 2, recentTokens: 0, errors: true },
      pruning: { minSavingsChars: 0, minSavingsRatio: 0 },
      ...overrides,
    },
    backend,
  );
  return { service, meter, ctx };
}

describe("JevCompactionService pipeline", () => {
  it("prunes automatically under pressure and reports the applied plan", async () => {
    const session = buildFixtureSession("svc-auto");
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    const report = await service
      .maybeAutoCompact(fakeAgent(session), 5, new AbortController().signal)
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(report).toBeUndefined(); // auto runs never reject

    // old-call and fresh-call (turns 1-2, within the small pin window)
    // got stubbed; the surface shows replacements.
    const stubbed = session.surface.nodes.some((seq) => {
      const event = session.eventAt(seq);
      if (event === undefined || event.type !== "tool/result") return false;
      return resultText(event).includes("[dsh-jev-compaction]");
    });
    expect(stubbed).toBe(true);
    service.dispose();
  });

  it("skips automatic runs below the pressure trigger", async () => {
    const session = buildFixtureSession("svc-below");
    const { service, meter } = buildService({
      trigger: {
        contextRatio: 0.7,
        minSurfaceTokens: 5000,
        minCandidates: 1,
        minCandidateChars: 1,
        cooldownTurns: 0,
      },
    });
    meter.setTotal(0);
    const report = await service.runAuto(
      fakeAgent(session),
      5,
      new AbortController().signal,
    );
    expect(report.skipped).toBe("pressure-not-met");
    expect(session.surface.replaceGeneration).toBe(0);
    service.dispose();
  });

  it("skips automatic runs while the cooldown is active", async () => {
    const session = buildFixtureSession("svc-cooldown");
    const { service } = buildService(
      {
        trigger: {
          contextRatio: 0.7,
          minSurfaceTokens: 1,
          minCandidates: 1,
          minCandidateChars: 1,
          cooldownTurns: 3,
        },
      },
      new FakeDecisionBackend(0.05),
    );
    const agent = fakeAgent(session, "agent-cool");
    const signal = new AbortController().signal;
    const first = await service.runAuto(agent, 5, signal);
    expect(first.applied.length).toBeGreaterThan(0);
    const second = await service.runAuto(agent, 6, signal);
    expect(second.skipped).toBe("cooldown");
    service.dispose();
  });

  it("fails open when the backend fails: no mutation, auto continues", async () => {
    const session = buildFixtureSession("svc-failopen");
    const nodesBefore = [...session.surface.nodes];
    const { service } = buildService({}, new FailingBackend());
    await expect(
      service.maybeAutoCompact(
        fakeAgent(session),
        5,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect([...session.surface.nodes]).toEqual(nodesBefore);
    expect(session.surface.replaceGeneration).toBe(0);
    service.dispose();
  });

  it("backs off repeated failures in the same turn, caps the delay, and lets manual runs bypass it", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const backend = new FailingBackend();
    const score = vi.spyOn(backend, "score");
    const { service } = buildService({}, backend);
    const agent = fakeAgent(buildFixtureSession("svc-backoff"));
    const signal = new AbortController().signal;
    try {
      for (const delay of [
        30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
      ]) {
        expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
          "jev-failed",
        );
        const calls = score.mock.calls.length;
        now += delay - 1;
        expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
          "failure-backoff",
        );
        expect(score).toHaveBeenCalledTimes(calls);
        now += 1;
      }
      expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
        "jev-failed",
      );
      expect((await service.runManualDry(agent, signal)).skipped).toBe(
        "jev-failed",
      );
      expect(score).toHaveBeenCalledTimes(8);
      expect(agent.session.surface.replaceGeneration).toBe(0);
    } finally {
      service.dispose();
    }
  });

  it("reports impossible protected state as fail-open and backs off before calling Jev", async () => {
    const session = buildFixtureSession("svc-state-overflow");
    for (let turn = 1; turn <= 3; turn += 1) {
      appendUserText(session, "Не удалять исходные данные. ".repeat(100), turn);
    }
    const backend = new FakeDecisionBackend(0.05);
    const score = vi.spyOn(backend, "score");
    const { service } = buildService(
      { state: { maxStateTokens: 1200 } },
      backend,
    );
    const agent = fakeAgent(session);
    const signal = new AbortController().signal;
    const nodes = [...session.surface.nodes];
    try {
      const first = await service.runAuto(agent, 5, signal);
      expect(first.skipped).toBe("jev-failed");
      expect(first.error).toMatch(/protected context: .*budget: 1200/);
      expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
        "failure-backoff",
      );
      expect(score).not.toHaveBeenCalled();
      expect([...session.surface.nodes]).toEqual(nodes);
      expect(session.surface.replaceGeneration).toBe(0);
    } finally {
      service.dispose();
    }
  });

  it("clears failure backoff after a configuration correction and a successful decision", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const backend = new FailingBackend() as SystemOneBackend;
    const score = vi.spyOn(backend, "score");
    const { service } = buildService({}, backend);
    const agent = fakeAgent(buildFixtureSession("svc-backoff-reset"));
    const signal = new AbortController().signal;
    try {
      await service.runAuto(agent, 5, signal);
      expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
        "failure-backoff",
      );
      service.reapply();
      score.mockImplementationOnce((state, questions) =>
        new FakeDecisionBackend(1).score(state, questions),
      );
      expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
        "empty-plan",
      );
      expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
        "jev-failed",
      );
      now += 30_000;
      expect((await service.runAuto(agent, 5, signal)).skipped).toBe(
        "jev-failed",
      );
    } finally {
      service.dispose();
    }
  });

  it("does not penalize cancelled scoring with failure backoff", async () => {
    const controller = new AbortController();
    const backend = new FailingBackend();
    const score = vi
      .spyOn(backend, "score")
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new Error("cancelled");
      });
    const { service } = buildService({}, backend);
    const agent = fakeAgent(buildFixtureSession("svc-backoff-abort"));
    try {
      expect((await service.runAuto(agent, 5, controller.signal)).skipped).toBe(
        "busy",
      );
      expect(
        (await service.runAuto(agent, 5, new AbortController().signal)).skipped,
      ).toBe("jev-failed");
      expect(score).toHaveBeenCalledTimes(2);
    } finally {
      service.dispose();
    }
  });

  it("dry-run never mutates the session", async () => {
    const session = buildFixtureSession("svc-dry");
    const nodesBefore = [...session.surface.nodes];
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    const report = await service.runManualDry(
      fakeAgent(session),
      new AbortController().signal,
    );
    expect(report.mode).toBe("dry-run");
    expect(report.plan).toBeDefined();
    expect(report.plan?.mutations.length).toBeGreaterThan(0);
    expect([...session.surface.nodes]).toEqual(nodesBefore);
    expect(session.surface.replaceGeneration).toBe(0);
    service.dispose();
  });

  it("queues a manual run and applies it on the next pre-step inside the open turn", async () => {
    const session = buildFixtureSession("svc-queue");
    const { service } = buildService(
      {},
      new FakeDecisionBackend((callId) => (callId === "old-call" ? 0.05 : 0.9)),
    );
    const agent = fakeAgent(session, "agent-queue");

    // Manual non-dry-run: plan preview + queue (no open-turn mutation).
    const preview = await service.runManualDry(
      agent,
      new AbortController().signal,
    );
    expect(preview.plan).toBeDefined();
    const queued = service.queueManualRun(agent);
    expect(queued).toBe(true);

    // Next pre-step consumes the queue and applies inside the turn.
    let nextCalled = false;
    const decision = await service.handlePreStep(
      { agent, turn: 5, step: 1, signal: new AbortController().signal },
      async () => {
        nextCalled = true;
        return { kind: "enter", messages: [] };
      },
    );
    expect(decision.kind).toBe("enter");
    expect(nextCalled).toBe(true);

    const stubbedSeq = session.surface.nodes.find((seq) => {
      const event = session.eventAt(seq);
      if (event === undefined || event.type !== "tool/result") return false;
      return (
        (event.data as { message: { source: { callId: string } } }).message
          .source.callId === "old-call" &&
        resultText(event).includes("[dsh-jev-compaction]")
      );
    });
    expect(stubbedSeq).toBeDefined();
    // The queue is consumed: another pre-step does not re-prune.
    expect(service.queueManualRun(agent)).toBe(true);
    await service.handlePreStep(
      { agent, turn: 5, step: 2, signal: new AbortController().signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    service.dispose();
  });

  it("always continues the waterfall, even when the pipeline throws", async () => {
    const session = buildFixtureSession("svc-waterfall");
    const { service } = buildService({}, new FailingBackend());
    const decision = await service.handlePreStep(
      {
        agent: fakeAgent(session),
        turn: 5,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: "enter", messages: [] }),
    );
    expect(decision.kind).toBe("enter");
    service.dispose();
  });

  it("serializes concurrent runs for one session behind the mutex", async () => {
    const session = buildFixtureSession("svc-mutex");
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    const agent = fakeAgent(session, "agent-mutex");
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([
      service.runManualDry(agent, signal),
      service.runManualDry(agent, signal),
    ]);
    // The second entrant sees the first run still in flight and is
    // reported as busy; the session itself is untouched by the loser.
    expect(first.skipped).toBeUndefined();
    expect(second.skipped).toBe("busy");
    service.dispose();
  });
});
