import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import {
  QaAnswerModes,
  QA_RAG_BLOCKED,
  QA_RAG_CONSENT_ID,
  QA_RAG_CONSENT_YES,
  QA_RAG_CONSENT_NO,
} from "../src/answer-modes.js";
import { qaAnswerModes } from "../src/shared/answer-modes.js";
import { QaQuestionGate, type QaQuestionRequest } from "../src/questions.js";
import type { QaSessionOwnership } from "../src/session-ownership.js";
import { fakeContext } from "./helpers/context-fakes.js";

// These policy tests use an in-memory Session double. Native record envelopes
// are exercised without this mock in answer-mode-records.test.ts.
vi.mock("@deepseek-ai/dsh-session", async (original) => ({
  ...(await original<typeof import("@deepseek-ai/dsh-session")>()),
  appendPluginRecord: (
    session: { append(type: string, data: unknown, metadata: object): void },
    type: string,
    data: unknown,
  ) => session.append(type, data, { ignorable: true }),
}));

function fixture() {
  const fake = fakeContext();
  const events: { type: string; data: unknown; ignorable?: true }[] = [];
  const root = {
    id: "root",
    header: {},
    get surface() {
      return { nodes: events.map((_, i) => i) };
    },
    eventAt: (seq: number) => events[seq],
    snapshotEvents: () => events,
    append: (
      type: string | readonly (readonly [string, unknown])[],
      data: unknown,
      metadata?: { ignorable?: true },
    ) => {
      events.push(
        ...(typeof type === "string"
          ? [{ type, data, ...metadata }]
          : type.map(([type, data]) => ({ type, data }))),
      );
    },
  };
  // Cordis may hand the Agent and SessionStore different scoped proxies.
  const agent = { id: "root", session: { ...root } } as unknown as Agent;
  const child = {
    id: "child",
    session: {
      id: "child",
      surface: { nodes: [] },
      eventAt: () => undefined,
      header: { origin: "subagent", parentSession: "root" },
    },
  } as unknown as Agent;
  let inherited = true;
  let guard: (call: {
    name: string;
    arguments: unknown;
    agent: Agent;
  }) => unknown = () => undefined;
  const ctx = Object.assign(fake.context, {
    sessions: {
      get: (id: string) => (id === "root" ? root : undefined),
      list: () => [root],
    },
    agents: { get: () => ({ inbox: { nextTurn: [], nextStep: [] } }) },
    tools: {
      guard: (callback: typeof guard) => {
        guard = callback;
        return vi.fn();
      },
    },
  }) as unknown as Context;
  const ownership = {
    install() {},
    rootOf: (id: string) =>
      id === "root" || (id === "child" && inherited) ? "root" : undefined,
  } as unknown as QaSessionOwnership;
  let policy = new QaAnswerModes(ctx, ownership);
  const gate = new QaQuestionGate(
    ctx,
    () => true,
    ownership,
    { debug() {}, info() {}, warn() {}, error() {} } as never,
    undefined,
    {
      prepare: (request) => policy.prepareQuestion(request),
      answered: (request, answer) => policy.answered(request, answer),
      cancelled: (request) => policy.cancelled(request),
    },
  );
  gate.install();
  let currentTurn = 0;
  const message = (rpcId?: string) =>
    createUserMessage({
      content: [
        { type: "text", text: "Research the synthetic documentation." },
      ],
      source: {
        kind: "user",
        ...(rpcId === undefined ? {} : { rpcId }),
      } as UserMessage["source"],
    });
  async function step(
    turn: number,
    messages: UserMessage[] = [],
    current = agent,
  ) {
    if (turn !== currentTurn) {
      currentTurn = turn;
      events.push({ type: "turn/start", data: { turn } });
    }
    const value = (await fake.dispatch(
      "agent/pre-step",
      { agent: current, turn },
      async () => ({ kind: "enter", messages }),
    )) as PreStepDecision;
    for (const msg of messages)
      events.push({ type: "user/message", data: msg });
    return value;
  }
  const ask = (
    question = {
      id: QA_RAG_CONSENT_ID,
      question: "Misleading caller text",
      options: [{ label: "Unrelated" }],
    },
  ) =>
    fake.dispatch(
      "user-questions/request",
      { agent, questions: [question] },
      async () => {
        throw new Error("No answerer");
      },
    );
  async function answer(selected: string[], custom?: string) {
    const waiting = ask();
    const pending = gate.list("root")[0]!;
    expect(pending.questions[0]?.question).toContain("Провести глубокий поиск");
    expect(pending.questions[0]?.options.map((x) => x.label)).toEqual([
      QA_RAG_CONSENT_YES,
      QA_RAG_CONSENT_NO,
    ]);
    gate.answer("root", pending.id, [
      {
        id: QA_RAG_CONSENT_ID,
        selected,
        ...(custom === undefined ? {} : { custom }),
      },
    ]);
    await waiting;
  }
  return {
    agent,
    child,
    dropInheritance() {
      inherited = false;
    },
    ctx,
    events,
    gate,
    message,
    step,
    ask,
    answer,
    get policy() {
      return policy;
    },
    reload() {
      policy.dispose();
      policy = new QaAnswerModes(ctx, ownership);
    },
    guard: (name: string, args: unknown = {}, current = agent) =>
      guard({ name, arguments: args, agent: current }),
    created(current: Agent) {
      fake.handler("agent/created")({ agent: current });
    },
    emitInbox(messages: UserMessage[]) {
      const event = {
        type: "agent/inbox/spliced",
        data: { target: "next-turn", inserted: messages },
      };
      events.push(event);
      fake.handler("session/event")(root, event);
    },
    dispose() {
      gate.dispose();
      policy.dispose();
    },
  };
}

describe("answer modes host policy", () => {
  it("loads skills without authorizing their non-RAG research instructions", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    const decision = await f.step(1, [f.message("request")]);
    expect(f.guard("skill", { name: "demo-glossary" })).toBeUndefined();
    expect(
      f.guard("skill", { name: "demo-glossary" }, f.child),
    ).toBeUndefined();
    for (const name of ["docs_search", "code_search", "domain_expert", "read"])
      expect(f.guard(name)).toBe(QA_RAG_BLOCKED);
    const note = JSON.stringify(decision);
    expect(note).toContain("relevant, substantive answer supported by sources");
    expect(note).toContain("concrete remaining gap");
    expect(note).toContain("not used a second retrieval mode");
    f.dispose();
  });

  it("exempts only the Host-created reviewer during the exact review call", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    await f.step(1, [f.message("request")]);
    // A child with a reviewer-looking prompt/label, created outside the trusted
    // call, has the same restrictions as every ordinary delegated agent.
    const ordinary = {
      id: "ordinary",
      session: {
        id: "ordinary",
        header: {
          origin: "subagent",
          parentSession: "root",
          label: "answer-review",
        },
      },
    } as unknown as Agent;
    f.created(ordinary);
    await f.policy.withAnswerReview(
      "root",
      new AbortController().signal,
      async () => {
        f.created(f.child);
        for (const name of [
          "read",
          "docs_search",
          "code_search",
          "structured_output",
        ])
          expect(f.guard(name, {}, f.child)).toBeUndefined();
        expect(f.guard("docs_search")).toBe(QA_RAG_BLOCKED);
        expect(f.guard("docs_search", {}, ordinary)).toBe(QA_RAG_BLOCKED);
        const decision = await f.step(1, [], f.child);
        expect(JSON.stringify(decision)).toContain(
          "independent answer reviewer",
        );
        expect(JSON.stringify(decision)).not.toContain(QA_RAG_BLOCKED);
      },
    );
    expect(f.guard("docs_search", {}, f.child)).toBe(QA_RAG_BLOCKED);
    expect(f.guard("docs_search")).toBe(QA_RAG_BLOCKED);
    f.dispose();
  });

  it("revokes reviewer access on cancellation and does not exempt another chat's child", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    await f.step(1, [f.message("request")]);
    const controller = new AbortController();
    await expect(
      f.policy.withAnswerReview("another-root", controller.signal, async () => {
        f.created(f.child);
        expect(f.guard("read", {}, f.child)).toBe(QA_RAG_BLOCKED);
        throw new Error("review failed");
      }),
    ).rejects.toThrow("review failed");
    await f.policy.withAnswerReview("root", controller.signal, async () => {
      f.created(f.child);
      expect(f.guard("read", {}, f.child)).toBeUndefined();
      controller.abort();
      expect(f.guard("read", {}, f.child)).toBe(QA_RAG_BLOCKED);
    });
    f.dispose();
  });

  it.each([false, true])(
    "does not apply an orphaned intent to later unprepared input (inserted before recovery: %s)",
    async (beforeRecovery) => {
      const f = fixture();
      const queued = f.message();
      const later = f.message();
      try {
        await f.policy.withCommand("root", ["fast", "rag"], async () => {
          f.emitInbox([queued]);
          f.reload();
          if (beforeRecovery) f.emitInbox([later]);
          await f.step(1, [queued]);
          expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
          if (!beforeRecovery) f.emitInbox([later]);
          f.reload();
          await f.step(2, [later]);
          expect(f.guard("read")).toBeUndefined();
        });
      } finally {
        f.dispose();
      }
    },
  );
  it("keeps queued Fast+RAG work restricted after interruption before the command returns", async () => {
    const f = fixture();
    const message = f.message();
    try {
      await f.policy.withCommand("root", ["fast", "rag"], async () => {
        f.emitInbox([message]);
        // Reconstruct only from the durable prefix, losing pending ALS state.
        f.reload();
        await f.step(1, [message]);
        expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
        f.policy.prepare("root", "later", ["deep"]);
        await f.step(2, [f.message("later")]);
        expect(f.guard("read")).toBeUndefined();
      });
    } finally {
      f.dispose();
    }
  });
  it("does not apply a completed command's strategy to an unrelated insertion", async () => {
    const f = fixture();
    await f.policy.withCommand("root", ["rag"], async () => undefined);
    const message = f.message();
    f.emitInbox([message]);
    f.reload();
    await f.step(1, [message]);
    expect(f.guard("read")).toBeUndefined();
    f.dispose();
  });
  it.each([
    { modes: ["fast"] as const, deep: false },
    { modes: ["fast", "deep"] as const, deep: true },
  ])(
    "applies only the selected research strategy: $modes",
    async ({ modes, deep }) => {
      const f = fixture();
      const message = f.message();
      const decision = await f.policy.withCommand("root", modes, async () => {
        f.emitInbox([message]);
        return f.step(1, [message]);
      });
      expect(decision.kind).toBe("enter");
      if (decision.kind !== "enter") throw new Error("Missing mode note.");
      const note = JSON.stringify(decision.messages.at(-1));
      expect(note).toContain("Fast selected:");
      expect(note.includes("Deep Thinking:")).toBe(deep);
      expect(note.includes("use available subagents")).toBe(deep);
      expect(f.guard("read")).toBeUndefined();
      f.dispose();
    },
  );
  it("restores a delegated child's RAG restriction from durable lineage after reload", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    await f.step(1, [f.message("request")]);
    f.dropInheritance();
    f.reload();
    expect(f.guard("read", {}, f.child)).toBe(QA_RAG_BLOCKED);
    f.dispose();
  });
  it("keeps RAG restrictions when an unrestricted message is steered into the same turn", async () => {
    const f = fixture();
    f.policy.prepare("root", "first", ["rag"]);
    await f.step(1, [f.message("first")]);
    await f.step(1, [f.message("steered")]);
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    await f.step(2, [f.message("later")]);
    expect(f.guard("read")).toBeUndefined();
    f.dispose();
  });
  it("does not let a delegated agent open consent for the root's current request", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    await f.step(1, [f.message("request")]);
    expect(() =>
      f.policy.prepareQuestion({
        agent: f.child,
        questions: [{ id: QA_RAG_CONSENT_ID, question: "Deep?" }],
      }),
    ).toThrow("owning request agent");
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    f.dispose();
  });
  it("validates selections and preserves canonical order", () => {
    expect(qaAnswerModes(["rag", "fast", "deep"])).toEqual([
      "fast",
      "deep",
      "rag",
    ]);
    for (const value of [[], ["unknown"], ["rag", "rag"], null])
      expect(() => qaAnswerModes(value)).toThrow();
  });

  it("binds modes to the exact admitted RPC and ignores future queued requests", async () => {
    const f = fixture();
    f.policy.prepare("root", "rag-request", ["rag", "deep"]);
    f.policy.prepare("root", "later-request", ["deep"]);
    await f.step(1, [f.message("rag-request")]);
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    expect(f.guard("qa_subagent")).toBe(QA_RAG_BLOCKED);
    expect(f.guard("research_code", {}, f.child)).toBe(QA_RAG_BLOCKED);
    expect(f.guard("dsh_lightrag_query", { mode: "hybrid" })).toBeUndefined();
    expect(f.guard("dsh_lightrag_query", { mode: "mix" })).toBeUndefined();
    expect(f.guard("dsh_lightrag_query", { mode: "bypass" })).toContain(
      "forbidden",
    );
    expect(f.guard("dsh_lightrag_query")).toContain("forbidden");
    expect(f.guard("ask_user_question")).toBeUndefined();
    await f.step(2, [f.message("later-request")]);
    expect(f.guard("read")).toBeUndefined();
    f.dispose();
  });

  it("uses the real question gate's fixed consent before allowing deep tools", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag", "deep"]);
    await f.step(1, [f.message("request")]);
    await f.answer([QA_RAG_CONSENT_YES]);
    expect(f.guard("read")).toBeUndefined();
    expect(f.guard("qa_subagent", {}, f.child)).toBeUndefined();
    f.reload();
    expect(f.guard("read")).toBeUndefined();
    f.policy.prepare("root", "next", ["rag"]);
    await f.step(2, [f.message("next")]);
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    f.dispose();
  });

  it.each([
    { selected: [QA_RAG_CONSENT_NO] },
    { selected: [] },
    { selected: [QA_RAG_CONSENT_YES, QA_RAG_CONSENT_NO] },
    { selected: [QA_RAG_CONSENT_YES], custom: "A different answer" },
    { selected: ["Unrelated"] },
  ])(
    "does not infer consent from refusal, skip, ambiguity or custom text: %j",
    async ({ selected, custom }) => {
      const f = fixture();
      f.policy.prepare("root", "request", ["rag"]);
      await f.step(1, [f.message("request")]);
      await f.answer(selected, custom);
      expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
      await expect(f.ask()).rejects.toThrow("without asking again");
      f.reload();
      expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
      f.dispose();
    },
  );

  it("closing the consent form and a forged answer never authorize deep search", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    await f.step(1, [f.message("request")]);
    const waiting = f.ask();
    const rejected = expect(waiting).rejects.toThrow("closed");
    f.gate.cancel("root", f.gate.list("root")[0]!.id);
    await rejected;
    f.policy.answered(
      {
        agent: f.agent,
        questions: [{ id: QA_RAG_CONSENT_ID, question: "Forged" }],
      },
      { answers: [{ id: QA_RAG_CONSENT_ID, selected: [QA_RAG_CONSENT_YES] }] },
    );
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    f.dispose();
  });

  it("rejects a stale question answer after another request was consumed", async () => {
    const f = fixture();
    f.policy.prepare("root", "first", ["rag"]);
    await f.step(1, [f.message("first")]);
    const request: QaQuestionRequest = f.policy.prepareQuestion({
      agent: f.agent,
      questions: [{ id: QA_RAG_CONSENT_ID, question: "Deep?" }],
    });
    f.policy.prepare("root", "second", ["rag"]);
    await f.step(2, [f.message("second")]);
    f.policy.answered(request, {
      answers: [{ id: QA_RAG_CONSENT_ID, selected: [QA_RAG_CONSENT_YES] }],
    });
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    f.dispose();
  });

  it("captures Fast+RAG from its exact command insertion even before the command returns", async () => {
    const f = fixture();
    const fast = f.message();
    await f.policy.withCommand("root", ["fast", "rag"], async () => {
      f.emitInbox([fast]);
      await f.step(1, [fast]);
      expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    });
    f.reload();
    expect(f.guard("read")).toBe(QA_RAG_BLOCKED);
    expect(
      f.events.some(
        (event) =>
          event.type === "plugin:dsh-qa-surface/answer-modes" &&
          event.ignorable === true,
      ),
    ).toBe(true);
    f.dispose();
  });

  it("does not allow retroactive changes and never turns a modes record into a review waiver", async () => {
    const f = fixture();
    f.policy.prepare("root", "request", ["rag"]);
    expect(() => f.policy.prepare("root", "request", ["deep"])).toThrow(
      "cannot change",
    );
    expect(() => f.policy.prepare("root", "fast", ["fast", "rag"])).toThrow(
      "no-review",
    );
    await f.step(1, [f.message("legacy-request")]);
    expect(() => f.policy.prepare("root", "legacy-request", ["rag"])).toThrow(
      "after",
    );
    expect(f.events.some((event) => event.type === "command/done")).toBe(false);
    f.dispose();
  });
});
