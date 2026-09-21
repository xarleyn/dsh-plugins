import { describe, expect, it, vi } from "vitest";
import {
  staticSessionLogReader,
  type QaSessionLogReader,
} from "../src/admin/session-log.js";
import type { StoredSessionEvent } from "../src/admin/conversation-log.js";
import { projectIntegrationTranscript } from "../src/integration/transcript.js";
import { QaIntegrationTranscriptReader } from "../src/integration/transcript-reader.js";

/**
 * The warm window a caller pages through. Two promises are tested here: the
 * pages it serves are the ones a whole-log projection would have served, for
 * every cursor, and the second page of a chat does not pay for the chat again —
 * neither with a stored read nor with the flattening of its whole history.
 */

const CHAT = "session-1";

function userMessage(seq: number): StoredSessionEvent {
  return {
    seq,
    time: 1_700_000_000_000 + seq * 1_000,
    type: "user/message",
    data: {
      source: { kind: "user" },
      content: [{ type: "text", text: `вопрос ${String(seq)}` }],
    },
  };
}

function answerMessage(seq: number): StoredSessionEvent {
  return {
    seq,
    time: 1_700_000_000_000 + seq * 1_000,
    type: "assistant/message",
    data: {
      message: { content: [{ type: "text", text: `ответ ${String(seq)}` }] },
    },
  };
}

/** Model plumbing between two messages: an event that is published by neither. */
function toolEvent(seq: number): StoredSessionEvent {
  return { seq, type: "tool/call", data: { name: "search", arguments: "{}" } };
}

/** One turn per message pair, with tool traffic interleaved as a real log has it. */
function conversation(turns: number, offset = 0): StoredSessionEvent[] {
  const events: StoredSessionEvent[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const base = offset + turn * 3;
    events.push(
      userMessage(base + 1),
      toolEvent(base + 2),
      answerMessage(base + 3),
    );
  }
  return events;
}

function fakeLog(
  input: {
    readonly events?: Readonly<Record<string, readonly StoredSessionEvent[]>>;
    readonly held?: Readonly<Record<string, readonly StoredSessionEvent[]>>;
  } = {},
) {
  const events = new Map<string, readonly StoredSessionEvent[]>(
    Object.entries(input.events ?? {}),
  );
  const held = new Map<string, readonly StoredSessionEvent[]>(
    Object.entries(input.held ?? {}),
  );
  const read = vi.fn(
    async (
      sessionId: string,
    ): Promise<
      | { readonly ok: true; readonly events: readonly StoredSessionEvent[] }
      | { readonly ok: false; readonly reason: "not-found" | "unreadable" }
    > => {
      const found = events.get(sessionId);
      return found === undefined
        ? { ok: false, reason: "not-found" }
        : { ok: true, events: found };
    },
  );
  const log: QaSessionLogReader = {
    live: (sessionId) => held.has(sessionId),
    snapshot: (sessionId) => held.get(sessionId),
    list: async () => ({ headers: [], complete: true }),
    read,
  };
  return { log, read, events, held };
}

describe("integration transcript reader probe", () => {
  it("asks the session only for what the window has not covered", async () => {
    // The probe is the one call that happens on every page, so it is asked from
    // the window's own cursor: a chat of ten thousand events must not hand the
    // reader ten thousand events to look at one new message.
    const log = staticSessionLogReader({
      held: [CHAT],
      events: { [CHAT]: [userMessage(1), answerMessage(2)] },
    });
    const snapshot = vi.spyOn(log, "snapshot");
    const reader = new QaIntegrationTranscriptReader({ log });

    await reader.page(CHAT, { after: 0, limit: 50 });
    await reader.page(CHAT, { after: 0, limit: 50 });
    expect(snapshot).toHaveBeenLastCalledWith(CHAT, { after: 2 });
  });

  it("materializes only the events above the cursor it was given", () => {
    const log = staticSessionLogReader({
      held: [CHAT],
      events: { [CHAT]: [userMessage(1), toolEvent(2), answerMessage(3)] },
    });
    expect(log.snapshot(CHAT)?.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(log.snapshot(CHAT, { after: 1 })?.map((event) => event.seq)).toEqual(
      [2, 3],
    );
    expect(log.snapshot(CHAT, { after: 3 })?.map((event) => event.seq)).toEqual(
      [],
    );
    // Not held is not the same answer as nothing written: a caller that cannot
    // tell them apart would cache half a conversation.
    expect(log.snapshot("session-elsewhere")).toBeUndefined();
  });
});

describe("integration transcript reader", () => {
  it("reads the log once and answers the next page from the window", async () => {
    const { log, read } = fakeLog({ events: { [CHAT]: conversation(2) } });
    const reader = new QaIntegrationTranscriptReader({ log });

    await expect(
      reader.page(CHAT, { after: 0, limit: 2 }),
    ).resolves.toMatchObject({ lastSeq: 6, truncated: true });
    const second = await reader.page(CHAT, { after: 3, limit: 2 });
    expect(second.messages.map((message) => message.seq)).toEqual([4, 6]);
    expect(second.lastSeq).toBe(6);
    expect(second.truncated).toBe(false);
    // The whole point: the stored log was touched once for two pages.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads the log again once the window ages out", async () => {
    let clock = 1_000;
    const { log, read } = fakeLog({ events: { [CHAT]: conversation(2) } });
    const reader = new QaIntegrationTranscriptReader({
      log,
      now: () => clock,
      ttlMs: 50,
    });

    await reader.page(CHAT, { after: 0, limit: 50 });
    await reader.page(CHAT, { after: 0, limit: 50 });
    expect(read).toHaveBeenCalledTimes(1);

    clock += 51;
    await reader.page(CHAT, { after: 0, limit: 50 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("extends the window from what the session holds, without reading the log", async () => {
    // The snapshot holds one message and nothing else, which is what a session
    // the Harness resumed, or a long one, really looks like: it may be used to
    // extend what the window knows and never to replace it.
    const { log, read, held } = fakeLog({
      events: { [CHAT]: conversation(2) },
      held: { [CHAT]: [] },
    });
    const reader = new QaIntegrationTranscriptReader({ log });

    await reader.page(CHAT, { after: 0, limit: 50 });
    held.set(CHAT, [answerMessage(7)]);

    const page = await reader.page(CHAT, { after: 6, limit: 50 });
    expect(page.messages.map((message) => message.seq)).toEqual([7]);
    expect(page.lastSeq).toBe(7);
    expect(read).toHaveBeenCalledTimes(1);

    // And the history is still there behind it.
    const history = await reader.page(CHAT, { after: 0, limit: 50 });
    expect(history.messages.map((message) => message.seq)).toEqual([
      1, 3, 4, 6, 7,
    ]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("answers a cursor below the window from the window's tail", async () => {
    const { log, read } = fakeLog({ events: { [CHAT]: conversation(4) } });
    const reader = new QaIntegrationTranscriptReader({ log, maxMessages: 3 });

    const page = await reader.page(CHAT, { after: 0, limit: 3 });
    // The window is the newest three messages; a cursor under it can only be
    // answered with the newest page, and truncation is what says so.
    expect(page.messages.map((message) => message.seq)).toEqual([9, 10, 12]);
    expect(page.lastSeq).toBe(12);
    expect(page.truncated).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("agrees with the whole-log projection for every cursor and page size", async () => {
    const events = conversation(4);
    const { log } = fakeLog({ events: { [CHAT]: events } });
    const reader = new QaIntegrationTranscriptReader({ log, maxMessages: 5 });

    // One warm chat, every cursor a caller can hold, three page sizes: the
    // window is only worth having if it cannot answer differently.
    await reader.page(CHAT, { after: 0, limit: 5 });
    for (const after of [0, 1, 2, 3, 5, 6, 9, 11, 12, 13]) {
      for (const limit of [1, 2, 5]) {
        await expect(reader.page(CHAT, { after, limit })).resolves.toEqual(
          projectIntegrationTranscript(CHAT, events, { after, limit }),
        );
      }
    }
  });

  it("keeps a bounded number of conversations warm", async () => {
    const { log, read } = fakeLog({
      events: {
        [CHAT]: conversation(2),
        "session-2": conversation(2),
      },
    });
    const reader = new QaIntegrationTranscriptReader({ log, maxChats: 1 });

    await reader.page(CHAT, { after: 0, limit: 50 });
    await reader.page("session-2", { after: 0, limit: 50 });
    expect(read).toHaveBeenCalledTimes(2);

    // The first chat walked out of its window, so it is read again rather than
    // remembered forever: a deployment's chats outnumber any cache.
    await reader.page(CHAT, { after: 0, limit: 50 });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("remembers nothing about a chat that has written nothing yet", async () => {
    const { log, read } = fakeLog();
    const reader = new QaIntegrationTranscriptReader({ log });

    await expect(reader.page(CHAT, { after: 7, limit: 50 })).resolves.toEqual({
      chatId: CHAT,
      messages: [],
      lastSeq: 7,
      truncated: false,
    });
    // A chat whose log does not exist yet may write any moment: an empty window
    // remembered here would be the answer to a question nobody has asked.
    await reader.page(CHAT, { after: 7, limit: 50 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports a log it cannot read, and forgets the window it dropped", async () => {
    let clock = 1_000;
    const { log, read } = fakeLog({ events: { [CHAT]: conversation(2) } });
    const reader = new QaIntegrationTranscriptReader({
      log,
      now: () => clock,
      ttlMs: 50,
    });
    await reader.page(CHAT, { after: 0, limit: 50 });

    read.mockImplementation(async () => ({ ok: false, reason: "unreadable" }));
    clock += 51;
    await expect(reader.page(CHAT, { after: 0, limit: 50 })).rejects.toThrow(
      /session log is unavailable \(unreadable\)/u,
    );
    await expect(reader.page(CHAT, { after: 0, limit: 50 })).rejects.toThrow(
      /session log is unavailable \(unreadable\)/u,
    );
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("reads the log when a chat writes more than a window between two reads", async () => {
    const { log, read, held, events } = fakeLog({
      events: { [CHAT]: conversation(1) },
      held: { [CHAT]: [] },
    });
    const reader = new QaIntegrationTranscriptReader({ log, maxMessages: 2 });
    await reader.page(CHAT, { after: 0, limit: 2 });

    // Three new turns at once: more than a window can hold, so the log answers
    // instead of a merge — by then the turns are its copy of them, which is why
    // nothing is lost by refusing to merge what memory has.
    events.set(CHAT, [...conversation(1), ...conversation(3, 3)]);
    held.set(CHAT, conversation(3, 3));
    const page = await reader.page(CHAT, { after: 3, limit: 2 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(page.messages.map((message) => message.seq)).toEqual([10, 12]);
    expect(page.truncated).toBe(true);
  });

  it("serves the newest page of a long chat, and knows what lies below it", async () => {
    // 10 000 messages. What the window keeps is one page, whatever the log
    // holds, and the cursor it hands back is the newest message of the page —
    // not of the chat, which the caller never asked to have paged through.
    const events: StoredSessionEvent[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      events.push(userMessage(index * 2 + 1), answerMessage(index * 2 + 2));
    }
    const { log, read } = fakeLog({ events: { [CHAT]: events } });
    const reader = new QaIntegrationTranscriptReader({ log });

    const page = await reader.page(CHAT, { after: 0, limit: 2 });
    expect(page.messages.map((message) => message.text)).toEqual([
      "вопрос 9999",
      "ответ 10000",
    ]);
    expect(page.lastSeq).toBe(10_000);
    expect(page.truncated).toBe(true);

    // The oldest cursor there is still answered from the window: the log of a
    // chat like this is read once, not once per page.
    const oldest = await reader.page(CHAT, { after: 0, limit: 50 });
    expect(oldest.messages).toHaveLength(50);
    expect(oldest.lastSeq).toBe(10_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
