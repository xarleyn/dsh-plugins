import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionLogSnapshot, SessionRecord } from "@deepseek-ai/dsh-session-query";
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config.js";
import { MemoryCorrectionStore } from "../src/dsh/storage.js";
import { CorrectionMinerEngine, type MinerLogger } from "../src/mining/engine.js";
import { header, userEvent } from "./fixtures/sessions.js";

const logger: MinerLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function liveSession(id: string, events: SessionEvent[] = []): Session {
  const sessionHeader = header(id);
  return { id, header: sessionHeader, events } as unknown as Session;
}

function turnEnd(seq: number): SessionEvent {
  return { type: "turn/end", seq, time: seq, data: {} } as unknown as SessionEvent;
}

function assistantActivity(seq: number): SessionEvent {
  return { type: "assistant/message", seq, time: seq, data: {} } as unknown as SessionEvent;
}

function liveEngine(
  config: Parameters<typeof resolveConfig>[0] = {},
  now: () => number = Date.now,
  warnings = vi.fn(),
): { engine: CorrectionMinerEngine; warnings: ReturnType<typeof vi.fn> } {
  const engineLogger: MinerLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnings,
    error: vi.fn(),
  };
  return {
    engine: new CorrectionMinerEngine(
      {
        async list() {
          return [];
        },
        async read() {
          throw new Error("not used by live observation");
        },
      },
      new MemoryCorrectionStore(),
      resolveConfig(config),
      engineLogger,
      now,
    ),
    warnings,
  };
}

describe("CorrectionMinerEngine", () => {
  it("scans incrementally, deduplicates, and sanitizes persisted snippets", async () => {
    const sessionHeader = header();
    const snapshot = {
      session: sessionHeader,
      events: [
        userEvent(0, "Начни"),
        userEvent(1, "Используй token=super-secret-value и pnpm, не npm."),
      ],
    } as SessionLogSnapshot;
    const record = { header: sessionHeader, live: false, persisted: true } as SessionRecord;
    const source = {
      async list() {
        return [record];
      },
      async read() {
        return snapshot;
      },
    };
    const store = new MemoryCorrectionStore();
    const engine = new CorrectionMinerEngine(
      source,
      store,
      resolveConfig({ privacy: { maxStoredTextChars: 128 } }),
      logger,
    );

    const first = await engine.scan({ cwd: sessionHeader.cwd!, incremental: true });
    const second = await engine.scan({ cwd: sessionHeader.cwd!, incremental: true });

    expect(first).toMatchObject({ correctionsFound: 1, correctionsAdded: 1 });
    expect(second).toMatchObject({ eventsScanned: 0, correctionsFound: 0, correctionsAdded: 0 });
    const [stored] = engine.list(sessionHeader.cwd!);
    expect(stored?.text).toContain("[REDACTED]");
    expect(stored?.text).not.toContain("super-secret-value");
    expect(stored?.textDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("contains a broken session and continues scanning the corpus", async () => {
    const firstHeader = header("broken");
    const secondHeader = header("good");
    const records = [firstHeader, secondHeader].map(
      (value) => ({ header: value, live: false, persisted: true }) as SessionRecord,
    );
    const source = {
      async list() {
        return records;
      },
      async read(sessionId: string) {
        if (sessionId === "broken") throw new Error("corrupt");
        return {
          session: secondHeader,
          events: [userEvent(0, "Не запускай deploy.")],
        } as SessionLogSnapshot;
      },
    };
    const engine = new CorrectionMinerEngine(
      source,
      new MemoryCorrectionStore(),
      resolveConfig(),
      logger,
    );
    await expect(engine.scan({ cwd: secondHeader.cwd! })).resolves.toMatchObject({
      sessionsScanned: 1,
      sessionsFailed: 1,
      correctionsAdded: 1,
    });
  });

  it("mines a normal live correction at turn/end", async () => {
    const { engine } = liveEngine();
    const correction = userEvent(0, "Не используй npm, используй pnpm.");
    const end = turnEnd(1);
    const session = liveSession("normal", [correction, end]);

    engine.observeEvent(session, correction);
    engine.observeEvent(session, end);

    await vi.waitFor(() => expect(engine.count(session.header.cwd!)).toBe(1));
  });

  it("keeps a hanging pending session alive while later events arrive", async () => {
    let clock = 0;
    const { engine } = liveEngine({ live: { pendingTtlMs: 100 } }, () => clock);
    const correction = userEvent(0, "Не используй npm, используй pnpm.");
    const activity = assistantActivity(1);
    const session = liveSession("hanging", [correction, activity]);

    engine.observeEvent(session, correction);
    clock = 90;
    engine.observeEvent(session, activity);
    clock = 180;
    engine.observeDisposed(session);

    await vi.waitFor(() => expect(engine.count(session.header.cwd!)).toBe(1));
  });

  it("expires a pending session without turn/end and ignores a late dispose", async () => {
    let clock = 0;
    const { engine, warnings } = liveEngine(
      { live: { pendingTtlMs: 100 } },
      () => clock,
    );
    const correction = userEvent(0, "Не используй npm, используй pnpm.");
    const session = liveSession("expired", [correction]);

    engine.observeEvent(session, correction);
    clock = 100;
    engine.observeDisposed(session);

    await Promise.resolve();
    expect(engine.count(session.header.cwd!)).toBe(0);
    expect(warnings).toHaveBeenCalledWith(
      "pending.evicted",
      expect.objectContaining({ reason: "ttl", sessionId: "expired", evictedEvents: 1 }),
    );
  });

  it("evicts bounded pending sessions and events with metadata-only warnings", async () => {
    let clock = 0;
    const { engine, warnings } = liveEngine(
      { live: { maxPendingSessions: 1, maxPendingEventsPerSession: 1 } },
      () => clock,
    );
    const firstCorrection = userEvent(0, "Не используй npm, используй pnpm.");
    const first = liveSession("first", [firstCorrection]);
    engine.observeEvent(first, firstCorrection);

    clock = 1;
    const secondCorrection = userEvent(0, "Не используй npm, используй pnpm.");
    const laterCorrection = userEvent(1, "Не используй npm, используй pnpm.");
    const second = liveSession("second", [secondCorrection, laterCorrection]);
    engine.observeEvent(second, secondCorrection);
    engine.observeEvent(second, laterCorrection);

    engine.observeDisposed(first);
    expect(engine.count(first.header.cwd!)).toBe(0);
    engine.observeDisposed(second);
    await vi.waitFor(() => expect(engine.count(second.header.cwd!)).toBe(2));

    expect(warnings).toHaveBeenCalledWith(
      "pending.evicted",
      expect.objectContaining({ reason: "session-cap", sessionId: "first" }),
    );
    expect(warnings).toHaveBeenCalledWith(
      "pending.evicted",
      expect.objectContaining({ reason: "event-cap", sessionId: "second" }),
    );
    for (const [, fields] of warnings.mock.calls) {
      expect(fields).not.toHaveProperty("text");
    }
  });

  it("clears pending sessions when disposed", async () => {
    const { engine } = liveEngine();
    const correction = userEvent(0, "Не используй npm, используй pnpm.");
    const session = liveSession("disposed", [correction]);

    engine.observeEvent(session, correction);
    engine.dispose();
    engine.observeDisposed(session);

    await Promise.resolve();
    expect(engine.count(session.header.cwd!)).toBe(0);
  });
});
