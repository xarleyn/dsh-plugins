import { describe, expect, it, vi } from "vitest";
import { QA_QUESTIONS_UNSUPPORTED, QaQuestionGate } from "../src/questions.js";
import { QaSessionOwnership } from "../src/session-ownership.js";
import { fakeContext, sessionAgent } from "./helpers/context-fakes.js";

interface QuestionAnswerItem {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
}

interface QuestionAnswer {
  readonly answers: readonly QuestionAnswerItem[];
}

const SILENT_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close() {},
};

/** A logger that keeps what the seam reported, for the observability tests. */
function recordingLogger() {
  const events: { level: string; event: string; payload: unknown }[] = [];
  const at =
    (level: string) =>
    (event: string, payload?: unknown): void => {
      events.push({ level, event, payload });
    };
  return {
    events,
    logger: {
      debug: at("debug"),
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      close() {},
    },
    names: () => events.map((entry) => entry.event),
    payloadOf(event: string): Record<string, unknown> {
      const found = events.find((entry) => entry.event === event);
      return (found?.payload ?? {}) as Record<string, unknown>;
    },
  };
}

const QUESTIONS = [
  {
    id: "target",
    question: "Куда писать отчёт?",
    header: "Формат",
    options: [
      { label: "В Confluence", description: "Со страницей-источником" },
      { label: "В чат" },
    ],
  },
];

function gateFor(input: {
  interactive: boolean;
  attested: readonly string[];
  logger?: unknown;
}) {
  const fake = fakeContext();
  const ownership = new QaSessionOwnership((sessionId) =>
    input.attested.includes(sessionId),
  );
  const gate = new QaQuestionGate(
    fake.context,
    () => input.interactive,
    ownership,
    (input.logger ?? SILENT_LOGGER) as never,
  );
  gate.install();
  /** Invoke the gate exactly where the user-questions service would. */
  const ask = (
    request: unknown,
    next: () => Promise<QuestionAnswer> = async () => ({
      answers: [{ id: "target", selected: ["delegated"] }],
    }),
  ) =>
    fake.handler("user-questions/request")(
      request,
      next,
    ) as Promise<QuestionAnswer>;
  return {
    gate,
    ask,
    fire: fake.handler,
    count: fake.count,
    dispatch: fake.dispatch,
    register: fake.register,
    prepended: fake.prepended,
  };
}

describe("QA question gate", () => {
  it("refuses a question for an attested chat while questions are unsupported", async () => {
    const { gate, ask } = gateFor({ interactive: false, attested: ["s1"] });
    await expect(
      ask({ questions: QUESTIONS, agent: sessionAgent("s1") }),
    ).rejects.toThrow(QA_QUESTIONS_UNSUPPORTED);
    gate.dispose();
  });

  it("leaves a session it did not attest to the chain", async () => {
    const { gate, ask } = gateFor({ interactive: false, attested: ["s1"] });
    await expect(
      ask({ questions: QUESTIONS, agent: sessionAgent("other") }),
    ).resolves.toEqual({
      answers: [{ id: "target", selected: ["delegated"] }],
    });
    expect(gate.list("other")).toEqual([]);
    gate.dispose();
  });

  it("delegates a request that carries no agent", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    await expect(ask({ questions: QUESTIONS })).resolves.toEqual({
      answers: [{ id: "target", selected: ["delegated"] }],
    });
    gate.dispose();
  });

  it("parks a request until the operator answers the form", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    expect(gate.list("s1")).toEqual([
      {
        id: expect.any(String),
        sessionId: "s1",
        createdAt: expect.any(Number),
        questions: [
          {
            id: "target",
            question: "Куда писать отчёт?",
            header: "Формат",
            detail: null,
            multiSelect: false,
            options: [
              { label: "В Confluence", description: "Со страницей-источником" },
              { label: "В чат", description: null },
            ],
          },
        ],
      },
    ]);
    const [request] = gate.list("s1");
    expect(
      gate.answer("s1", request!.id, [{ id: "target", selected: ["В чат"] }]),
    ).toBe(true);
    await expect(pending).resolves.toEqual({
      answers: [{ id: "target", selected: ["В чат"] }],
    });
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("reports a question the browser left out as skipped, never as a choice", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = ask({
      questions: [QUESTIONS[0], { id: "tone", question: "Каким тоном?" }],
      agent: sessionAgent("s1"),
    });
    await Promise.resolve();
    const [request] = gate.list("s1");
    gate.answer("s1", request!.id, [{ id: "target", selected: ["В чат"] }]);
    await expect(pending).resolves.toEqual({
      answers: [
        { id: "target", selected: ["В чат"] },
        { id: "tone", selected: [] },
      ],
    });
    gate.dispose();
  });

  it("keeps only the offered labels and lets free text decide a single-select", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = ask({
      questions: [
        QUESTIONS[0],
        {
          id: "tone",
          question: "Каким тоном?",
          options: [{ label: "Кратко" }],
        },
      ],
      agent: sessionAgent("s1"),
    });
    await Promise.resolve();
    const [request] = gate.list("s1");
    gate.answer("s1", request!.id, [
      // A label this question never offered cannot become the model's answer.
      { id: "target", selected: ["В Telegram"] },
      // Free text on a single-select replaces the choice it was sent beside.
      { id: "tone", selected: ["Кратко"], custom: "  Сухо  " },
    ]);
    await expect(pending).resolves.toEqual({
      answers: [
        { id: "target", selected: [] },
        { id: "tone", selected: [], custom: "Сухо" },
      ],
    });
    gate.dispose();
  });

  it("closes a request without answering it when the operator cancels", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    const [request] = gate.list("s1");
    expect(gate.cancel("s1", request!.id)).toBe(true);
    await expect(pending).rejects.toThrow(/closed the question/u);
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("refuses an answer or a cancel for another chat or an unknown request", async () => {
    const { gate, ask } = gateFor({
      interactive: true,
      attested: ["s1", "s2"],
    });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    const [request] = gate.list("s1");
    expect(gate.answer("s2", request!.id, [])).toBe(false);
    expect(gate.cancel("s2", request!.id)).toBe(false);
    expect(gate.answer("s1", "no-such-request", [])).toBe(false);
    expect(gate.list("s1")).toHaveLength(1);
    gate.cancel("s1", request!.id);
    await pending.catch(() => undefined);
    gate.dispose();
  });

  it("folds a malformed wire payload into the refusal/skip semantics", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    const pending = ask({
      questions: [QUESTIONS[0], { id: "tone", question: "Каким тоном?" }],
      agent: sessionAgent("s1"),
    });
    await Promise.resolve();
    const [request] = gate.list("s1");
    // A non-array payload is refused like a foreign id: the request stays.
    expect(gate.answer("s1", request!.id, "answers" as unknown as [])).toBe(
      false,
    );
    expect(gate.list("s1")).toHaveLength(1);
    // A garbage array settles the form: unknown entries and non-string or
    // non-offered selections degrade to skips, never to a crash.
    expect(
      gate.answer("s1", request!.id, [
        null,
        42,
        { id: "target", selected: "В чат" },
        { id: "tone", selected: ["Кратко"], custom: 7 },
      ] as unknown as []),
    ).toBe(true);
    await expect(pending).resolves.toEqual({
      answers: [
        { id: "target", selected: [] },
        { id: "tone", selected: [] },
      ],
    });
    gate.dispose();
  });

  it("closes the wait when the turn's signal aborts", async () => {
    const { gate, ask } = gateFor({ interactive: true, attested: ["s1"] });
    const controller = new AbortController();
    const pending = ask({
      questions: QUESTIONS,
      agent: sessionAgent("s1"),
      signal: controller.signal,
    });
    await Promise.resolve();
    expect(gate.list("s1")).toHaveLength(1);
    controller.abort();
    await expect(pending).rejects.toThrow(/closed the question/u);
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("closes the wait of an agent that goes away", async () => {
    const { gate, ask, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    (fire("agent/disposed") as (event: unknown) => void)({
      agent: sessionAgent("s1"),
    });
    await expect(pending).rejects.toThrow(/closed the question/u);
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("closes every parked request on disposal and detaches its listener", async () => {
    const { gate, ask, count } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    gate.dispose();
    await expect(pending).rejects.toThrow(/closed the question/u);
    expect(count("user-questions/request")).toBe(0);
  });
});

describe("QA question gate ownership", () => {
  it("claims its own chat's question before any other answerer sees it", async () => {
    const { gate, dispatch, register, prepended } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    // The stock DSH answerer is mounted in every page the plugin runs in: it
    // registers first, so only a prepended claim keeps a QA question out of a
    // composer the overlay has hidden.
    const stock = vi.fn(async () => ({
      answers: [{ id: "target", selected: ["stock"] }],
    }));
    register("user-questions/request", stock as never);
    expect(prepended("user-questions/request")).toBe(true);

    const pending = dispatch(
      "user-questions/request",
      { questions: QUESTIONS, agent: sessionAgent("s1") },
      async () => ({ answers: [{ id: "target", selected: ["terminal"] }] }),
    );
    await Promise.resolve();
    expect(stock).not.toHaveBeenCalled();
    const [request] = gate.list("s1");
    expect(request).toBeDefined();
    gate.answer("s1", request!.id, [{ id: "target", selected: ["В чат"] }]);
    await expect(pending).resolves.toEqual({
      answers: [{ id: "target", selected: ["В чат"] }],
    });
    gate.dispose();
  });

  it("leaves another surface's question to the answerer behind it", async () => {
    const { gate, dispatch, register } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const stock = vi.fn(async () => ({
      answers: [{ id: "target", selected: ["stock"] }],
    }));
    register("user-questions/request", stock as never);

    await expect(
      dispatch(
        "user-questions/request",
        { questions: QUESTIONS, agent: sessionAgent("elsewhere") },
        async () => ({ answers: [] }),
      ),
    ).resolves.toEqual({ answers: [{ id: "target", selected: ["stock"] }] });
    expect(stock).toHaveBeenCalledTimes(1);
    expect(gate.list("elsewhere")).toEqual([]);
    gate.dispose();
  });

  it("answers a delegated child's question under the chat that owns it", async () => {
    const { gate, ask, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    (fire("session/created") as (session: unknown) => void)({
      id: "child-1",
      header: { id: "child-1", parentSession: "s1" },
    });
    const pending = ask({
      questions: QUESTIONS,
      agent: sessionAgent("child-1"),
    });
    await Promise.resolve();
    // The child never appears in the admission, so a request that reaches the
    // gate from one is listed and answered under the chat the operator sees.
    expect(gate.list("s1")).toHaveLength(1);
    expect(gate.list("child-1")).toEqual([]);
    const [request] = gate.list("s1");
    expect(gate.answer("s1", request!.id, [])).toBe(true);
    await expect(pending).resolves.toEqual({
      answers: [{ id: "target", selected: [] }],
    });
    gate.dispose();
  });
});

describe("QA question gate lifecycle", () => {
  it("closes a parked question when the asking agent stops running", async () => {
    const { gate, ask, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    expect(gate.list("s1")).toHaveLength(1);
    // A turn that is only ending elsewhere leaves the question alone.
    (fire("agent/status") as (event: unknown) => void)({
      agent: sessionAgent("s1"),
      status: "running",
    });
    expect(gate.list("s1")).toHaveLength(1);
    // Once the agent is idle no answer can reach the turn that asked, so the
    // request must not stay parked in front of the operator.
    (fire("agent/status") as (event: unknown) => void)({
      agent: sessionAgent("s1"),
      status: "idle",
    });
    await expect(pending).rejects.toThrow(/closed the question/u);
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });

  it("keeps another agent's parked question when one goes idle", async () => {
    const { gate, ask, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
    });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    (fire("agent/status") as (event: unknown) => void)({
      agent: sessionAgent("s2"),
      status: "idle",
    });
    expect(gate.list("s1")).toHaveLength(1);
    gate.cancel("s1", gate.list("s1")[0]!.id);
    await pending.catch(() => undefined);
    gate.dispose();
  });
});

describe("QA question gate observability", () => {
  it("reports the claim and the answer without the operator's text", async () => {
    const recorder = recordingLogger();
    const { gate, ask } = gateFor({
      interactive: true,
      attested: ["s1"],
      logger: recorder.logger,
    });
    const pending = ask({
      questions: [QUESTIONS[0], { id: "tone", question: "Каким тоном?" }],
      agent: sessionAgent("s1"),
    });
    await Promise.resolve();
    const [request] = gate.list("s1");
    expect(recorder.payloadOf("question.claimed")).toEqual({
      sessionId: "s1",
      requestId: request!.id,
      questions: 2,
    });
    gate.answer("s1", request!.id, [
      { id: "target", selected: ["В чат"] },
      { id: "tone", selected: [], custom: "Сухо и по делу" },
    ]);
    await pending;
    const answered = recorder.payloadOf("question.answered");
    expect(answered).toEqual({
      sessionId: "s1",
      requestId: request!.id,
      questions: 2,
      hasCustomAnswer: true,
    });
    // The answer text itself is never part of the record.
    expect(JSON.stringify(recorder.events)).not.toContain("Сухо и по делу");
    gate.dispose();
  });

  it("tells a cancelled question from an aborted one", async () => {
    const recorder = recordingLogger();
    const { gate, ask, fire } = gateFor({
      interactive: true,
      attested: ["s1"],
      logger: recorder.logger,
    });
    const aborted = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    (fire("agent/status") as (event: unknown) => void)({
      agent: sessionAgent("s1"),
      status: "idle",
    });
    await aborted.catch(() => undefined);
    expect(recorder.payloadOf("question.aborted")).toEqual({
      sessionId: "s1",
      requestId: expect.any(String),
      reason: "idle",
    });

    const cancelled = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    gate.cancel("s1", gate.list("s1")[0]!.id);
    await cancelled.catch(() => undefined);
    expect(recorder.payloadOf("question.cancelled")).toEqual({
      sessionId: "s1",
      requestId: expect.any(String),
    });
    // The operator's own cancel is not an abort.
    expect(
      recorder.events.filter((entry) => entry.event === "question.aborted"),
    ).toHaveLength(1);
    gate.dispose();
  });

  it("records a delegated question without naming a foreign chat", async () => {
    const recorder = recordingLogger();
    const { gate, ask } = gateFor({
      interactive: true,
      attested: ["s1"],
      logger: recorder.logger,
    });
    await ask({ questions: QUESTIONS, agent: sessionAgent("private-chat") });
    expect(recorder.payloadOf("question.delegated")).toEqual({
      reason: "unowned",
    });
    expect(JSON.stringify(recorder.events)).not.toContain("private-chat");
    gate.dispose();
  });

  it("records an answer refused for a request it does not hold", async () => {
    const recorder = recordingLogger();
    const { gate, ask } = gateFor({
      interactive: true,
      attested: ["s1"],
      logger: recorder.logger,
    });
    const pending = ask({ questions: QUESTIONS, agent: sessionAgent("s1") });
    await Promise.resolve();
    expect(gate.answer("s1", "unknown-request", [])).toBe(false);
    expect(recorder.payloadOf("question.refused")).toEqual({
      sessionId: "s1",
      requestId: "unknown-request",
    });
    gate.cancel("s1", gate.list("s1")[0]!.id);
    await pending.catch(() => undefined);
    gate.dispose();
  });
});
