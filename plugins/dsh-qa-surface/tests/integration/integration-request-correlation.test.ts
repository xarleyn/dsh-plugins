import { describe, expect, it, vi } from "vitest";
import type { StoredSessionEvent } from "../../src/admin/conversation-log.js";
import type { QaSessionLogReader } from "../../src/admin/session-log.js";
import { createQaIntegrationRunner } from "../../src/integration/host-runner.js";
import type { QaIntegrationRunner } from "../../src/integration/contract.js";
import type { QaTurnSources } from "../../src/provenance/types.js";
import { resolveConfig } from "../../src/resolve-config.js";

/**
 * Which turn answers which question (issue #339).
 *
 * `/qa/api/ask` admits a question and reads the answer back out of the durable
 * log, and two callers may have the same chat open at once. Selecting "the
 * newest prompt in the log" turns that pair into one queue: the first caller
 * reads the second one's turn and publishes an answer nobody asked for. The
 * harness echoes each prompt's rpc id onto the durable user row, so the runner
 * is expected to find *its* row, read the turn that row was claimed into, and
 * cite that turn's provenance rather than the chat's newest bundle.
 */

const config = resolveConfig({
  accounts: { enabled: true },
  integration: { enabled: true },
});

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
} as never;

/** One committed assistant message of one turn. */
function says(turn: number, text: string): unknown {
  return { turn, message: { content: [{ type: "text", text }] } };
}

/** One turn that was cut off before it wrote any prose. */
function interrupted(turn: number): unknown {
  return { turn, message: { content: [] }, interrupted: true };
}

/** One question's turn, as the chat's log and provenance store record it. */
interface SettledTurn {
  readonly turn: number;
  readonly question: string;
}

/**
 * A chat whose agent admits every question and settles them together, so the
 * whole log is in place before either caller reads it — the interleaving a
 * selection by "latest" cannot survive.
 */
function racingChat(input: {
  readonly expected: number;
  readonly commit: (turn: number, question: string) => readonly unknown[];
}) {
  const events: StoredSessionEvent[] = [];
  const settledTurns: SettledTurn[] = [];
  let seq = 0;
  const push = (type: string, data: unknown): void => {
    events.push({ seq: ++seq, time: 1_700_000_000_000 + seq, type, data });
  };
  let settle: () => void = () => {};
  const quiescent = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const prompt = vi.fn(
    async (request: {
      readonly requestId: string;
      readonly content: readonly { readonly text?: string }[];
    }): Promise<void> => {
      const question =
        request.content.find((part) => part.text !== undefined)?.text ?? "";
      const turn = settledTurns.length + 1;
      push("turn/start", { turn });
      push("user/message", {
        role: "user",
        source: { kind: "user", rpcId: request.requestId },
        content: [{ type: "text", text: question }],
      });
      settledTurns.push({ turn, question });
      if (settledTurns.length < input.expected) return;
      // Every question is admitted: the loop runs each turn to its answer and
      // only then goes idle, so both readers see both answers in the log.
      for (const entry of settledTurns) {
        for (const message of input.commit(entry.turn, entry.question)) {
          push("assistant/message", message);
        }
      }
      settle();
    },
  );
  return {
    prompt,
    agent: { whenIdle: () => quiescent },
    read: async () => ({ ok: true as const, events: [...events] }),
    /** The evidence each turn collected, keyed by the question it answered. */
    bundles: (): QaTurnSources[] =>
      settledTurns.map((entry) => ({
        version: 1,
        sessionId: "chat-1",
        turn: entry.turn,
        complete: true,
        sources: [{ id: `src-${String(entry.turn)}`, title: entry.question }],
      })) as unknown as QaTurnSources[],
  };
}

function runnerOf(chat: ReturnType<typeof racingChat>) {
  return createQaIntegrationRunner({
    ctx: {
      sessionController: { prompt: chat.prompt },
      agents: { get: () => chat.agent },
    } as never,
    getConfig: () => config,
    accounts: () => undefined,
    admission: { secureSessionForUser: async () => {} } as never,
    access: {} as never,
    sessionLog: {
      list: vi.fn(),
      live: () => true,
      snapshot: () => undefined,
      read: chat.read as QaSessionLogReader["read"],
    } as never,
    provenance: { bundles: chat.bundles } as never,
    documents: () => undefined,
    logger,
  });
}

function ask(api: QaIntegrationRunner, message: string) {
  return api.run({
    userId: "u-1",
    chatId: "chat-1",
    message,
    attachments: [],
    ticketKey: null,
    signal: new AbortController().signal,
  });
}

describe("integration answer correlation", () => {
  it("answers each concurrent question with its own turn", async () => {
    const chat = racingChat({
      expected: 2,
      commit: (turn, question) => [says(turn, `ответ на ${question}`)],
    });
    const api = runnerOf(chat);
    const [first, second] = await Promise.all([
      ask(api, "первый вопрос"),
      ask(api, "второй вопрос"),
    ]);

    // Whichever order the two prompts arrived in, each caller is answered by
    // the turn that carried its own question and cites that turn's evidence.
    expect(first.answer).toBe("ответ на первый вопрос");
    expect(first.sources.map((source) => source.title)).toEqual([
      "первый вопрос",
    ]);
    expect(second.answer).toBe("ответ на второй вопрос");
    expect(second.sources.map((source) => source.title)).toEqual([
      "второй вопрос",
    ]);
  });

  it("publishes nothing to a question whose own turn committed no prose", async () => {
    // One turn was cut off before it wrote any text and the other answered in
    // full. Reading "the newest turn" used to hand the first caller the other
    // one's prose; an empty answer is the honest report of its own turn.
    const chat = racingChat({
      expected: 2,
      commit: (turn, question) =>
        question === "мой вопрос"
          ? [interrupted(turn)]
          : [says(turn, "ответ чужого вопроса")],
    });
    const api = runnerOf(chat);
    const [mine, theirs] = await Promise.all([
      ask(api, "мой вопрос"),
      ask(api, "чужой вопрос"),
    ]);

    expect(mine.answer).toBe("");
    expect(mine.interrupted).toBe(true);
    // The evidence still belongs to this turn: an answer of nothing cites
    // nothing of the other one's.
    expect(mine.sources.map((source) => source.title)).toEqual(["мой вопрос"]);
    expect(theirs.answer).toBe("ответ чужого вопроса");
    expect(theirs.sources.map((source) => source.title)).toEqual([
      "чужой вопрос",
    ]);
  });
});
