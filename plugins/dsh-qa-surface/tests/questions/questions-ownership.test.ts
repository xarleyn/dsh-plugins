import { describe, expect, it, vi } from "vitest";
import { gateFor, QUESTIONS, sessionAgent } from "./questions.helpers.js";

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
