import { describe, expect, it, vi } from "vitest";
import { QaHostQuestionBridge } from "../src/client/questions.js";
import type { QaPendingQuestion } from "../src/types.js";
import type { QaQuestionApi } from "../src/client/types.js";

const REQUEST: QaPendingQuestion = {
  id: "question-1",
  sessionId: "chat-1",
  createdAt: 1,
  questions: [
    {
      id: "target",
      question: "Куда писать отчёт?",
      header: null,
      detail: null,
      multiSelect: false,
      options: [{ label: "В чат", description: null }],
    },
  ],
};

/** A Host namespace stub whose calls the test resolves by hand or by value. */
function api(overrides: Partial<QaQuestionApi> = {}): QaQuestionApi {
  return {
    pendingQuestions: vi.fn(async () => ({ ok: true as const, value: [] })),
    answerQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
    cancelQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
    ...overrides,
  };
}

describe("QA host question bridge", () => {
  it("publishes a changed list and stays quiet about an unchanged one", async () => {
    const pendingQuestions = vi
      .fn()
      .mockResolvedValue({ ok: true as const, value: [REQUEST] });
    const bridge = new QaHostQuestionBridge(api({ pendingQuestions }));
    const onChanged = vi.fn();
    await bridge.refresh("chat-1", "token", onChanged);
    expect(bridge.list()).toEqual([REQUEST]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // A poll that reads the same list must not republish it: the surface
    // re-renders on every publish.
    await bridge.refresh("chat-1", "token", onChanged);
    expect(onChanged).toHaveBeenCalledTimes(1);
    bridge.reset();
  });

  it("coalesces overlapping polls of the same chat", async () => {
    let release: (value: {
      ok: true;
      value: readonly QaPendingQuestion[];
    }) => void;
    const pendingQuestions = vi.fn(
      () =>
        new Promise<{ ok: true; value: readonly QaPendingQuestion[] }>(
          (resolve) => {
            release = resolve;
          },
        ),
    );
    const bridge = new QaHostQuestionBridge(api({ pendingQuestions }));
    const first = bridge.refresh("chat-1", "token", () => undefined);
    const second = bridge.refresh("chat-1", "token", () => undefined);
    release!({ ok: true, value: [REQUEST] });
    await Promise.all([first, second]);
    expect(pendingQuestions).toHaveBeenCalledTimes(1);
    expect(bridge.list()).toEqual([REQUEST]);
    bridge.reset();
  });

  it("drops a response that outlived its chat", async () => {
    let release: (value: {
      ok: true;
      value: readonly QaPendingQuestion[];
    }) => void;
    const pendingQuestions = vi.fn(
      () =>
        new Promise<{ ok: true; value: readonly QaPendingQuestion[] }>(
          (resolve) => {
            release = resolve;
          },
        ),
    );
    const bridge = new QaHostQuestionBridge(api({ pendingQuestions }));
    const onChanged = vi.fn();
    const refresh = bridge.refresh("chat-1", "token", onChanged);
    // The operator switched chats while the poll was in flight.
    bridge.reset();
    release!({ ok: true, value: [REQUEST] });
    await refresh;
    expect(bridge.list()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
    bridge.reset();
  });

  it("answers a request and re-reads the list it belonged to", async () => {
    const answerQuestion = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const pendingQuestions = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [REQUEST] })
      .mockResolvedValue({ ok: true as const, value: [] });
    const bridge = new QaHostQuestionBridge(
      api({ answerQuestion, pendingQuestions }),
    );
    await bridge.refresh("chat-1", "token", () => undefined);
    await bridge.answer("chat-1", "token", "question-1", [
      { id: "target", selected: ["В чат"] },
    ]);
    expect(answerQuestion).toHaveBeenCalledWith(
      "token",
      "chat-1",
      "question-1",
      [{ id: "target", selected: ["В чат"] }],
    );
    expect(bridge.list()).toEqual([]);
    bridge.reset();
  });

  it("keeps the form when the answer never reached the host", async () => {
    const answerQuestion = vi.fn(async () => {
      throw new Error("socket closed");
    });
    const pendingQuestions = vi.fn(async () => ({
      ok: true as const,
      value: [REQUEST],
    }));
    const bridge = new QaHostQuestionBridge(
      api({ answerQuestion, pendingQuestions }),
    );
    await bridge.refresh("chat-1", "token", () => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await bridge.answer("chat-1", "token", "question-1", []);
    // A transport failure is not an answer: the operator's form stays until
    // the next poll reconciles it with what the Host actually holds.
    expect(bridge.list()).toEqual([REQUEST]);
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "dsh-qa-surface: question answer failed",
    );
    errorSpy.mockRestore();
    bridge.reset();
  });

  it("drops the settled request when the list cannot be re-read", async () => {
    const pendingQuestions = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [REQUEST] })
      .mockResolvedValue({ ok: false as const, error: new Error("offline") });
    const bridge = new QaHostQuestionBridge(api({ pendingQuestions }));
    await bridge.refresh("chat-1", "token", () => undefined);
    await bridge.cancel("chat-1", "token", "question-1");
    // The request was settled, so leaving a form the operator already closed
    // on screen would be worse than showing nothing.
    expect(bridge.list()).toEqual([]);
    bridge.reset();
  });

  it("is inert on a page whose host has no question namespace", async () => {
    const bridge = new QaHostQuestionBridge(undefined);
    expect(bridge.available).toBe(false);
    const onChanged = vi.fn();
    await bridge.refresh("chat-1", "token", onChanged);
    await bridge.answer("chat-1", "token", "question-1", []);
    expect(bridge.list()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
    bridge.reset();
  });
});
