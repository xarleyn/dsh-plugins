import type { SessionLogSnapshot, SessionRecord } from "@deepseek-ai/dsh-session-query";
import { describe, expect, it } from "vitest";
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
});
