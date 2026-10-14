import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { QaAccounts } from "../../src/accounts/store.js";
import {
  QaIntegrationQuestionPolicy,
  QA_INTEGRATION_NO_CLARIFICATIONS,
} from "../../src/integration/question-policy.js";

function fixture() {
  const events: { type: string; data: unknown }[] = [];
  const root = {
    id: "root",
    header: {},
    get seq() {
      return events.length;
    },
    eventAt: (seq: number) => events[seq - 1],
  };
  const child = {
    id: "child",
    header: { origin: "subagent", parentSession: "root" },
  };
  let parentAvailable = true;
  const listeners = new Map<string, (...args: never[]) => unknown>();
  let guard: (execution: unknown) => unknown = () => undefined;
  const accounts = {
    ownerIdOf: (id: string) => (id === "root" ? "owner" : undefined),
    integrationClarificationsAllowed: (id: string, requestId: string) =>
      !(id === "root" && requestId === "no-questions"),
  } as unknown as QaAccounts;
  const ctx = {
    on: (name: string, handler: (...args: never[]) => unknown) => {
      listeners.set(name, handler);
      return vi.fn();
    },
    tools: {
      guard: (handler: typeof guard) => {
        guard = handler;
        return vi.fn();
      },
    },
    sessions: {
      get: (id: string) =>
        id === "root" && parentAvailable ? root : undefined,
    },
  } as unknown as Context;
  const policy = new QaIntegrationQuestionPolicy(
    ctx,
    () => accounts,
    () => "root",
  );
  const agent = { id: "root", session: root } as unknown as Agent;
  const delegated = { id: "child", session: child } as unknown as Agent;
  const step = async (turn: number, requestIds: string[], current = agent) => {
    const messages = requestIds.map((rpcId) => ({
      source: { kind: "user", rpcId },
      content: [],
    }));
    return (await listeners.get("agent/pre-step")!(
      { agent: current, turn } as never,
      (async () => ({ kind: "continue", messages })) as never,
    )) as { messages: { content?: { text?: string }[] }[] };
  };
  return {
    releaseParent: () => {
      parentAvailable = false;
    },
    policy,
    agent,
    delegated,
    root,
    events,
    step,
    guard: (name: string, current = agent) => guard({ name, agent: current }),
  };
}

describe("integration question policy", () => {
  it("refuses a clarification when an attested child cannot resolve its root policy", () => {
    const f = fixture();
    f.releaseParent();
    expect(f.policy.allowed(f.delegated)).toBe(false);
    f.policy.dispose();
  });
  it("keeps ordinary delegated questions enabled when the root policy allows them", async () => {
    const f = fixture();
    await f.step(1, ["allowed"]);
    expect(f.policy.allowed(f.delegated)).toBe(true);
    expect(f.guard("ask_user_question", f.delegated)).toBeUndefined();
    f.policy.dispose();
  });
  it("blocks the clarification tool and informs both the root and delegated agent", async () => {
    const f = fixture();
    const decision = await f.step(1, ["no-questions"]);
    expect(decision.messages.at(-1)?.content?.[0]?.text).toBe(
      QA_INTEGRATION_NO_CLARIFICATIONS,
    );
    expect(f.policy.allowed(f.agent)).toBe(false);
    expect(f.guard("ask_user_question")).toBe(QA_INTEGRATION_NO_CLARIFICATIONS);
    expect(f.guard("read")).toBeUndefined();
    expect(f.policy.allowed(f.delegated)).toBe(false);
    expect(
      (await f.step(1, [], f.delegated)).messages.at(-1)?.content?.[0]?.text,
    ).toBe(QA_INTEGRATION_NO_CLARIFICATIONS);
    expect(f.guard("ask_user_question", f.delegated)).toBe(
      QA_INTEGRATION_NO_CLARIFICATIONS,
    );
    f.policy.dispose();
  });

  it("keeps a mixed turn restricted, then restores normal policy on the next turn", async () => {
    const f = fixture();
    await f.step(1, ["allowed", "no-questions"]);
    await f.step(1, ["allowed"]);
    expect(f.policy.allowed(f.agent)).toBe(false);
    const next = await f.step(2, ["browser-request"]);
    expect(f.policy.allowed(f.agent)).toBe(true);
    expect(f.guard("ask_user_question")).toBeUndefined();
    expect(next.messages.at(-1)?.content?.[0]?.text).toContain(
      "previous integration turn's restriction no longer applies",
    );
    f.policy.dispose();
  });

  it("recovers only consumed current-turn policies after reload, ignoring future queued input", () => {
    const f = fixture();
    f.events.push(
      { type: "turn/start", data: { turn: 1 } },
      { type: "user/message", data: { source: { rpcId: "no-questions" } } },
      {
        type: "agent/inbox/spliced",
        data: { inserted: [{ source: { rpcId: "allowed" } }] },
      },
    );
    expect(f.policy.allowed(f.agent)).toBe(false);
    expect(f.policy.allowed(f.delegated)).toBe(false);
    f.policy.dispose();
  });
});
