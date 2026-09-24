import { describe, expect, it } from "vitest";
import {
  gateFor,
  QUESTIONS,
  recordingLogger,
  sessionAgent,
} from "./questions.helpers.js";

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
