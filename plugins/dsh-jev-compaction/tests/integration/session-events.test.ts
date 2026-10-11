/**
 * The durable session events the pipeline writes (SPEC §28): the acceptance
 * criteria of Issue #14, end to end.
 *
 * - S1: an applied run leaves exactly one record, matching the report field
 *   for field, with a seq pair per replacement;
 * - S2: a dry-run leaves one record marked `dry-run` that replaced nothing;
 * - S3: skip reasons are silent by default and on request carry the reason;
 * - S4: the record survives a replay and holds no pruned output text.
 */

import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import {
  KNOWN_SESSION_EVENT_TYPES,
  Session,
  SessionId,
} from "@deepseek-ai/dsh-session";
import type { SessionEvent, SessionSeq } from "@deepseek-ai/dsh-session";
import { JevCompactionService } from "../../src/service.js";
import {
  JEV_COMPACTION_APPLIED_EVENT,
  JEV_COMPACTION_SKIPPED_EVENT,
  type JevCompactionAppliedEventData,
} from "../../src/observability/session-events.js";
import {
  FakeDecisionBackend,
  buildFixtureSession,
  fakeAgent,
  fakeTokenMeter,
} from "../helpers/session.js";

function buildService(
  overrides: Record<string, unknown> = {},
  backend?: ConstructorParameters<typeof JevCompactionService>[2],
): { service: JevCompactionService; meter: ReturnType<typeof fakeTokenMeter> } {
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
  return { service, meter };
}

function eventsOf(session: Session, type: string): readonly SessionEvent[] {
  return session.snapshotEvents().filter((event) => event.type === type);
}

function appliedOf(session: Session): JevCompactionAppliedEventData[] {
  return session
    .snapshotEvents()
    .filter((event) => event.type === JEV_COMPACTION_APPLIED_EVENT)
    .map((event) => event.data as JevCompactionAppliedEventData);
}

/** The original result text the fixture writes for the first tool step. */
const ORIGINAL_TEXT = "x".repeat(4000);

describe("durable session events", () => {
  it("S1: an applied run records one card matching the report", async () => {
    const session = buildFixtureSession("evt-applied");
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    const report = await service.runAuto(
      fakeAgent(session),
      5,
      new AbortController().signal,
    );
    service.dispose();

    const records = appliedOf(session);
    expect(records).toHaveLength(1);
    const data = records[0]!;
    expect(data.mode).toBe("auto");
    expect(["context-ratio", "token-floor"]).toContain(data.trigger);
    expect(data.candidates).toBe(report.candidates);
    expect(data.mutations).toBe(report.plan?.mutations.length);
    expect(data.applied).toBe(report.applied.length);
    expect(data.actions.KEEP_STUB).toBe(report.stubbed);
    expect(data.tokensBefore).toBe(report.tokensBefore);
    expect(data.tokensAfter).toBe(report.tokensAfter);
    expect(data.charsSaved).toBe(report.charsBefore - report.charsAfter);
    expect(data.items).toHaveLength(report.candidates);

    // Every replacement is addressable: original seq to replacement seq, and
    // the pair really is in the log, with a replaced body at the second seq.
    const landed = new Map(
      report.applied.map((entry) => [
        Number(entry.originalSeq),
        Number(entry.replacementSeq),
      ]),
    );
    expect(landed.size).toBe(report.applied.length);
    for (const item of data.items) {
      const replacement = landed.get(item.originalSeq);
      if (item.action === "KEEP_FULL") {
        expect(replacement).toBeUndefined();
        expect(item.replacementSeq).toBeNull();
        continue;
      }
      expect(replacement).toBeDefined();
      expect(item.replacementSeq).toBe(replacement);
      expect(session.eventAt(replacement! as SessionSeq)?.type).toBe(
        "tool/result",
      );
    }
  });

  it("S2: a dry-run records a preview that replaced nothing", async () => {
    const session = buildFixtureSession("evt-dry");
    const nodesBefore = [...session.surface.nodes];
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    const report = await service.runManualDry(
      fakeAgent(session),
      new AbortController().signal,
    );
    service.dispose();

    const records = appliedOf(session);
    expect(records).toHaveLength(1);
    expect(records[0]!.mode).toBe("dry-run");
    expect(records[0]!.applied).toBe(0);
    expect(
      records[0]!.items.every((item) => item.replacementSeq === null),
    ).toBe(true);
    expect(report.plan?.mutations.length).toBeGreaterThan(0);
    // Nothing on the surface moved.
    expect([...session.surface.nodes]).toEqual(nodesBefore);
    expect(session.surface.replaceGeneration).toBe(0);
  });

  it("S3: skips are silent by default and named on request", async () => {
    const quiet = buildFixtureSession("evt-quiet");
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
      fakeAgent(quiet),
      5,
      new AbortController().signal,
    );
    service.dispose();
    expect(report.skipped).toBe("pressure-not-met");
    expect(eventsOf(quiet, JEV_COMPACTION_SKIPPED_EVENT)).toHaveLength(0);

    const loud = buildFixtureSession("evt-loud");
    const chatty = buildService({
      trigger: {
        contextRatio: 0.7,
        minSurfaceTokens: 5000,
        minCandidates: 1,
        minCandidateChars: 1,
        cooldownTurns: 0,
      },
      diagnostics: { showSkipReasons: true },
    });
    chatty.meter.setTotal(0);
    const skipped = await chatty.service.runAuto(
      fakeAgent(loud),
      5,
      new AbortController().signal,
    );
    chatty.service.dispose();
    expect(skipped.skipped).toBe("pressure-not-met");
    const notes = eventsOf(loud, JEV_COMPACTION_SKIPPED_EVENT);
    expect(notes).toHaveLength(1);
    expect((notes[0]!.data as { reason: string }).reason).toBe(
      "pressure-not-met",
    );
  });

  it("S3: a mutex skip is a race, not a decision, and is never recorded", async () => {
    const session = buildFixtureSession("evt-busy");
    const { service } = buildService(
      { diagnostics: { showSkipReasons: true } },
      new FakeDecisionBackend(0.05),
    );
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([
      service.runManualDry(fakeAgent(session), signal),
      service.runManualDry(fakeAgent(session), signal),
    ]);
    service.dispose();
    expect(first.skipped).toBeUndefined();
    expect(second.skipped).toBe("busy");
    expect(eventsOf(session, JEV_COMPACTION_SKIPPED_EVENT)).toHaveLength(0);
  });

  it("records nothing when the operator turns the cards off", async () => {
    const session = buildFixtureSession("evt-off");
    const { service } = buildService(
      { diagnostics: { sessionCards: false } },
      new FakeDecisionBackend(0.05),
    );
    const report = await service.runAuto(
      fakeAgent(session),
      5,
      new AbortController().signal,
    );
    service.dispose();
    expect(report.applied.length).toBeGreaterThan(0);
    expect(appliedOf(session)).toHaveLength(0);
  });

  it("S4: the record replays verbatim and holds no pruned output", async () => {
    const session = buildFixtureSession("evt-replay");
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    await service.runAuto(fakeAgent(session), 5, new AbortController().signal);
    service.dispose();

    const log = session.snapshotEvents();
    const replayed = Session.create(SessionId("evt-replay"), log);
    const records = appliedOf(replayed);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(appliedOf(session)[0]);

    // Metadata only: not a character of the pruned output, not the stub that
    // replaced it, not an archive reference, not the Jev state body.
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain(ORIGINAL_TEXT);
    expect(serialized).not.toContain("[dsh-jev-compaction]");
    expect(serialized).not.toContain("sha256:");
    for (const item of records[0]!.items) {
      // A whitelist, not a snapshot: any new field has to be argued for here,
      // and a field carrying content cannot pass.
      expect([...Object.keys(item)].sort()).toEqual([
        "action",
        "chars",
        "needContents",
        "needVerbatim",
        "originalSeq",
        "replacementSeq",
        "tool",
      ]);
      expect(item.chars).toBeGreaterThan(0);
    }
  });

  it("joins the harness vocabulary while mounted and leaves on dispose", () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has(JEV_COMPACTION_APPLIED_EVENT)).toBe(
      false,
    );
    const { service } = buildService({}, new FakeDecisionBackend(0.05));
    expect(KNOWN_SESSION_EVENT_TYPES.has(JEV_COMPACTION_APPLIED_EVENT)).toBe(
      true,
    );
    expect(KNOWN_SESSION_EVENT_TYPES.has(JEV_COMPACTION_SKIPPED_EVENT)).toBe(
      true,
    );
    service.dispose();
    expect(KNOWN_SESSION_EVENT_TYPES.has(JEV_COMPACTION_APPLIED_EVENT)).toBe(
      false,
    );
    expect(KNOWN_SESSION_EVENT_TYPES.has(JEV_COMPACTION_SKIPPED_EVENT)).toBe(
      false,
    );
  });
});
