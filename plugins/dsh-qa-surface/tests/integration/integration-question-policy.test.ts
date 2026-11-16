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
    surface: { nodes: [] as number[] },
    eventAt: (seq: number) => events[seq],
  };
  const childEvents: typeof events = [];
  const child = {
    id: "child",
    header: { origin: "subagent", parentSession: "root" },
    surface: { nodes: [] as number[] },
    eventAt: (seq: number) => childEvents[seq],
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
  const createPolicy = () =>
    new QaIntegrationQuestionPolicy(
      ctx,
      () => accounts,
      () => "root",
    );
  let policy = createPolicy();
  const agent = { id: "root", session: root } as unknown as Agent;
  const delegated = { id: "child", session: child } as unknown as Agent;
  const step = async (
    turn: number,
    requestIds: string[],
    current = agent,
    commit = true,
  ) => {
    const messages = requestIds.map((rpcId) => ({
      source: { kind: "user", rpcId },
      content: [],
    }));
    const decision = (await listeners.get("agent/pre-step")!(
      { agent: current, turn } as never,
      (async () => ({ kind: "enter", messages })) as never,
    )) as {
      messages: { source?: { kind: string }; content?: { text?: string }[] }[];
    };
    if (commit) {
      const session = current === agent ? root : child;
      const log = current === agent ? events : childEvents;
      log.push({ type: "turn/start", data: { turn } });
      for (const message of decision.messages) {
        session.surface.nodes.push(log.length);
        log.push({ type: "user/message", data: message });
      }
    }
    return decision;
  };
  return {
    releaseParent: () => {
      parentAvailable = false;
    },
    get policy() {
      return policy;
    },
    reload: () => {
      policy.dispose();
      policy = createPolicy();
    },
    compact: (current = agent) => {
      (current === agent ? root : child).surface.nodes.splice(0);
    },
    agent,
    delegated,
    root,
    events,
    step,
    guard: (name: string, current = agent) => guard({ name, agent: current }),
  };
}

describe("integration question policy", () => {
  it.each(["allowed", "no-questions"])(
    "keeps unchanged %s guidance once across steps and turns while enforcing every turn",
    async (requestId) => {
      const f = fixture();
      expect((await f.step(1, [requestId])).messages).toHaveLength(2);
      expect((await f.step(1, [])).messages).toEqual([]);
      for (const turn of [2, 3]) {
        expect((await f.step(turn, [requestId])).messages).toHaveLength(1);
        expect(f.policy.allowed(f.agent)).toBe(requestId === "allowed");
        expect(f.policy.allowed(f.delegated)).toBe(requestId === "allowed");
      }
      f.policy.dispose();
    },
  );

  it("restores unchanged blocked guidance immediately after compaction, including in a child", async () => {
    const f = fixture();
    await f.step(1, ["no-questions"]);
    await f.step(1, [], f.delegated);
    f.compact();
    f.compact(f.delegated);
    expect((await f.step(1, [])).messages.at(-1)?.content?.[0]?.text).toBe(
      QA_INTEGRATION_NO_CLARIFICATIONS,
    );
    expect(
      (await f.step(1, [], f.delegated)).messages.at(-1)?.content?.[0]?.text,
    ).toBe(QA_INTEGRATION_NO_CLARIFICATIONS);
    expect((await f.step(1, [])).messages).toEqual([]);
    expect(f.guard("ask_user_question")).toBe(QA_INTEGRATION_NO_CLARIFICATIONS);
    f.policy.dispose();
  });

  it("preserves retained guidance after reload and restores it after removal", async () => {
    const f = fixture();
    await f.step(1, ["no-questions"]);
    f.reload();
    expect((await f.step(1, [])).messages).toEqual([]);
    expect(f.guard("ask_user_question")).toBe(QA_INTEGRATION_NO_CLARIFICATIONS);
    f.compact();
    expect((await f.step(2, ["allowed"])).messages).toHaveLength(2);
    expect(f.guard("ask_user_question")).toBeUndefined();
    f.policy.dispose();
  });

  it("emits the latest changed policy even when an older matching note remains in history", async () => {
    const f = fixture();
    await f.step(1, ["allowed"]);
    expect(
      (await f.step(2, ["no-questions"])).messages.at(-1)?.content?.[0]?.text,
    ).toBe(QA_INTEGRATION_NO_CLARIFICATIONS);
    expect(
      (await f.step(3, ["allowed"])).messages.at(-1)?.content?.[0]?.text,
    ).toContain("previous integration turn's restriction no longer applies");
    expect((await f.step(4, ["allowed"])).messages).toHaveLength(1);
    expect(f.guard("ask_user_question")).toBeUndefined();
    f.policy.dispose();
  });

  it("does not treat an abandoned guidance proposal as retained", async () => {
    const f = fixture();
    expect(
      (await f.step(1, ["allowed"], f.agent, false)).messages,
    ).toHaveLength(2);
    expect((await f.step(1, ["allowed"])).messages).toHaveLength(2);
    f.policy.dispose();
  });
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
