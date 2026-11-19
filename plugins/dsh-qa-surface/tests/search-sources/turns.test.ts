import { describe, it, expect, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  SourceTurns,
  type SourceGrant,
} from "../../src/search-sources/turns.js";

function setup() {
  const listeners = new Map<string, (...args: never[]) => unknown>();
  const ctx = {
    on: (name: string, fn: (...args: never[]) => unknown) => {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const remove = vi.fn();
  const expose = vi.fn(() => remove);
  const turns = new SourceTurns(ctx as unknown as Context, expose);
  const grant: SourceGrant = {
    session: "chat",
    actor: "owner",
    role: "reader",
    binding: { skill: "demo", label: "Demo", directory: "demo" },
    verify: vi.fn(),
  };
  const session = { id: "chat", header: { origin: "root" } };
  const agent = { session } as unknown as Agent;
  const msg = (id: string, kind = "user") => ({
    id,
    source: { kind, rpcId: id },
    content: [{ type: "text", text: "/demo test" }],
  });
  const emit = (name: string, ...args: unknown[]) =>
    listeners.get(name)!(...(args as never[]));
  const event = (type: string, data: unknown = {}) =>
    emit("session/event", session, { type, data });
  const step = async (...messages: ReturnType<typeof msg>[]) =>
    emit(
      "agent/pre-step",
      { agent, turn: 1, messages, signal: new AbortController().signal },
      async () => ({
        kind: "enter",
        messages,
      }),
    );
  const submit = (id: string) =>
    turns.submit(
      "chat",
      (_id, rpc) => rpc === id,
      async () => {
        turns.admit(grant);
        event("agent/inbox/spliced", { inserted: [msg(id)] });
      },
    );
  return { grant, agent, turns, msg, event, step, submit, expose, remove };
}

describe("message-scoped source access", () => {
  it("checks the live grant before reporting the reader to selfcheck", async () => {
    const h = setup();
    expect(await h.turns.available(h.agent)).toBe(false);
    await h.submit("chosen");
    await h.step(h.msg("chosen"));
    expect(await h.turns.available(h.agent)).toBe(true);
    vi.mocked(h.grant.verify).mockRejectedValue(new Error("revoked"));
    expect(await h.turns.available(h.agent)).toBe(false);
    h.turns.dispose();
  });
  it("requires the exact admitted message, agent and turn, including on regeneration", async () => {
    const h = setup();
    await h.step(h.msg("plain"));
    expect(() => h.turns.current(h.agent)).toThrow();
    await h.submit("picked");
    expect(() => h.turns.current(h.agent)).toThrow();
    h.event("turn/start", { turn: 1 });
    await h.step(h.msg("picked"));
    const active = h.turns.current(h.agent);
    expect(active.grant).toBe(h.grant);
    expect(h.expose).toHaveBeenCalledExactlyOnceWith(h.agent);
    expect(() =>
      h.turns.current({ session: h.agent.session } as Agent),
    ).toThrow();
    h.event("turn/end", { turn: 1 });
    expect(active.end.signal.aborted).toBe(true);
    expect(h.remove).toHaveBeenCalledTimes(1);
    await h.step(h.msg("picked", "retry"));
    expect(() => h.turns.current(h.agent)).toThrow();
    await h.step(h.msg("picked"));
    expect(() => h.turns.current(h.agent)).toThrow();
    expect(h.expose).toHaveBeenCalledTimes(1);
    h.turns.dispose();
  });
  it("drops removed, mixed, cancelled and unselected steering grants", async () => {
    const h = setup();
    await h.submit("removed");
    h.turns.drop("chat", "removed");
    await h.step(h.msg("removed"));
    expect(() => h.turns.current(h.agent)).toThrow();
    await h.submit("edited");
    await h.step({
      ...h.msg("edited"),
      content: [{ type: "text", text: "ordinary edit" }],
    });
    expect(() => h.turns.current(h.agent)).toThrow();
    await h.submit("mixed");
    await h.step(h.msg("mixed"), h.msg("ordinary"));
    expect(() => h.turns.current(h.agent)).toThrow();
    await h.submit("first");
    await h.step(h.msg("first"));
    const first = h.turns.current(h.agent);
    await h.step(h.msg("ordinary"));
    expect(first.end.signal.aborted).toBe(true);
    await h.submit("second");
    await h.step(h.msg("second"));
    const second = h.turns.current(h.agent);
    h.turns.cancel("chat");
    expect(second.end.signal.aborted).toBe(true);
    h.turns.dispose();
  });
});
