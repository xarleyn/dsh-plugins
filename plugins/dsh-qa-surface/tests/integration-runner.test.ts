import { describe, expect, it, vi } from "vitest";
import { createQaIntegrationRunner } from "../src/integration/host-runner.js";
import { resolveConfig } from "../src/resolve-config.js";
import type { QaSessionLogReader } from "../src/admin/session-log.js";
import type { StoredSessionEvent } from "../src/admin/conversation-log.js";

/**
 * The integration runner's read half. Opening a chat and asking a question are
 * the harness's own machinery and are exercised end to end elsewhere; what this
 * file pins is what a caller reads back, which is the part an external contract
 * depends on: the durable log is the source, a chat that has said nothing yet
 * is an empty conversation rather than a failure, and a log that cannot be read
 * is reported as a failure rather than answered with silence.
 */

const config = resolveConfig({
  accounts: { enabled: true },
  integration: { enabled: true },
});

function events(): StoredSessionEvent[] {
  return [
    {
      seq: 1,
      time: 1_700_000_001_000,
      type: "user/message",
      data: { source: { kind: "user" }, content: [{ type: "text", text: "вопрос" }] },
    },
    {
      seq: 2,
      time: 1_700_000_002_000,
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "ответ" }] } },
    },
  ];
}

function runner(options: {
  readonly read: QaSessionLogReader["read"];
  readonly snapshot?: QaSessionLogReader["snapshot"];
  readonly modelCatalog?: () => Promise<unknown>;
}) {
  return createQaIntegrationRunner({
    ctx: {
      sessionController: {
        modelCatalog:
          options.modelCatalog ??
          (async () => ({ groups: [] })),
      },
    } as never,
    getConfig: () => config,
    accounts: () => undefined,
    admission: {} as never,
    access: {} as never,
    sessionLog: {
      list: vi.fn(),
      live: () => options.snapshot !== undefined,
      snapshot: options.snapshot ?? (() => undefined),
      read: options.read,
    } as never,
    provenance: {} as never,
    documents: () => undefined,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      close() {},
    } as never,
  });
}

describe("integration runner reads", () => {
  it("projects the durable log into the caller's page", async () => {
    const read = vi.fn(async () => ({ ok: true as const, events: events() }));
    const api = runner({ read });
    const transcript = await api.transcript({
      chatId: "session-1",
      after: 0,
      limit: 50,
    });
    expect(read).toHaveBeenCalledWith("session-1");
    expect(
      transcript.messages.map((message) => [message.seq, message.role]),
    ).toEqual([
      [1, "user"],
      [2, "assistant"],
    ]);
    expect(transcript.lastSeq).toBe(2);
    expect(transcript.truncated).toBe(false);
  });

  it("honours the caller's cursor and window", async () => {
    const api = runner({
      read: async () => ({ ok: true as const, events: events() }),
    });
    const transcript = await api.transcript({
      chatId: "session-1",
      after: 1,
      limit: 1,
    });
    expect(transcript.messages.map((message) => message.seq)).toEqual([2]);
    expect(transcript.lastSeq).toBe(2);
  });

  it("treats a chat that has written nothing yet as an empty conversation", async () => {
    // The ownership record is written before the first message, so a chat
    // whose log is not there yet has said nothing rather than gone missing.
    const api = runner({ read: async () => ({ ok: false, reason: "not-found" }) });
    await expect(
      api.transcript({ chatId: "session-1", after: 7, limit: 50 }),
    ).resolves.toEqual({
      chatId: "session-1",
      messages: [],
      lastSeq: 7,
      truncated: false,
    });
  });

  it("reports a log it cannot read instead of an empty chat", async () => {
    const api = runner({
      read: async () => ({ ok: false, reason: "unreadable" }),
    });
    await expect(
      api.transcript({ chatId: "session-1", after: 0, limit: 50 }),
    ).rejects.toThrow(/session log is unavailable \(unreadable\)/u);
  });

  it("reads the log once for a caller that pages through a chat", async () => {
    const read = vi.fn(async () => ({ ok: true as const, events: events() }));
    const api = runner({ read });
    await api.transcript({ chatId: "session-1", after: 0, limit: 1 });
    await api.transcript({ chatId: "session-1", after: 1, limit: 1 });
    // The runner keeps its windows for the plugin's lifetime, so the second
    // page of the same chat is not a second stored read.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("sees a turn the session has written but storage has not flushed", async () => {
    const held: StoredSessionEvent[] = [];
    const read = vi.fn(async () => ({ ok: true as const, events: events() }));
    const api = runner({ read, snapshot: () => held });
    await api.transcript({ chatId: "session-1", after: 0, limit: 50 });

    held.push({
      seq: 3,
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "ответ 2" }] } },
    });
    const page = await api.transcript({
      chatId: "session-1",
      after: 2,
      limit: 50,
    });
    expect(page.messages.map((message) => message.text)).toEqual(["ответ 2"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("lists the routable models by their own ids", async () => {
    const api = runner({
      read: async () => ({ ok: true as const, events: [] }),
      modelCatalog: async () => ({
        groups: [
          { models: [{ id: "gpt-4o-mini" }, { id: "local-llm-v3" }] },
          { models: [{ id: "embedding-1" }] },
        ],
      }),
    });
    await expect(api.models()).resolves.toEqual([
      "gpt-4o-mini",
      "local-llm-v3",
      "embedding-1",
    ]);
  });
});
