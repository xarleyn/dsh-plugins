import { describe, expect, it, vi } from "vitest";
import { QA_QUESTIONS_UNSUPPORTED } from "../../src/questions.js";
import { gateFor, QUESTIONS, sessionAgent } from "./questions.helpers.js";

describe("QA question gate", () => {
  it("releases the tool without a client and tells the agent why there is no answer", async () => {
    vi.useFakeTimers();
    const { ask, gate } = gateFor({ interactive: true, attested: ["s1"] });
    try {
      const result = expect(
        ask({ questions: QUESTIONS, agent: sessionAgent("s1") }),
      ).rejects.toThrow(
        /timed out after 30 minutes without a user response.*No answer or approval/u,
      );
      vi.advanceTimersByTime(30 * 60_000 - 1);
      const [request] = gate.list("s1");
      expect(request!.expiresAt).toBe(request!.createdAt + 30 * 60_000);
      vi.advanceTimersByTime(1);
      await result;
      expect(gate.list("s1")).toEqual([]);
      expect(gate.answer("s1", request!.id, [])).toBe(false);
    } finally {
      gate.dispose();
      vi.useRealTimers();
    }
  });

  it("pins each deadline, refuses a late answer before its timer runs, and clears a settled timer", async () => {
    vi.useFakeTimers();
    let minutes = 2;
    const { ask, gate } = gateFor({
      interactive: true,
      attested: ["s1"],
      timeoutMinutes: () => minutes,
    });
    try {
      const request = { questions: QUESTIONS, agent: sessionAgent("s1") };
      const expired = expect(ask(request)).rejects.toThrow(
        /timed out after 2 minutes/u,
      );
      const [first] = gate.list("s1");
      minutes = 10;
      const answered = ask(request);
      vi.setSystemTime(first!.createdAt + 2 * 60_000);
      expect(gate.answer("s1", first!.id, [])).toBe(false);
      await expired;
      const [second] = gate.list("s1");
      expect(second!.expiresAt).toBe(second!.createdAt + 10 * 60_000);
      expect(
        gate.answer("s1", second!.id, [{ id: "target", selected: ["В чат"] }]),
      ).toBe(true);
      await expect(answered).resolves.toEqual({
        answers: [{ id: "target", selected: ["В чат"] }],
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      gate.dispose();
      vi.useRealTimers();
    }
  });
  it("never parks a blocked integration clarification even when the deployment is interactive", async () => {
    const { gate, ask } = gateFor({
      interactive: true,
      attested: ["s1"],
      questionMode: () => "blocked",
    });
    await expect(
      ask({ questions: QUESTIONS, agent: sessionAgent("s1") }),
    ).rejects.toThrow("Clarifying questions are disabled");
    expect(gate.list("s1")).toEqual([]);
    gate.dispose();
  });
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
        expiresAt: expect.any(Number),
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
