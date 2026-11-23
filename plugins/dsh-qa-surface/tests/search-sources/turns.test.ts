import { describe, it, expect, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ArchiveGateway } from "../../src/search-sources/gateway.js";
import { sourceTool } from "../../src/search-sources/tool.js";
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
  const claim = (message: ReturnType<typeof msg>) =>
    emit("agent/inbox/claimed", { agent, turn: 1, message });
  const enter = async (...messages: ReturnType<typeof msg>[]) =>
    emit(
      "agent/pre-step",
      { agent, turn: 1, messages, signal: new AbortController().signal },
      async () => ({
        kind: "enter",
        messages,
      }),
    );
  const step = async (...messages: ReturnType<typeof msg>[]) => {
    for (const message of messages) claim(message);
    return enter(...messages);
  };
  const submit = (id: string) =>
    turns.submit(
      "chat",
      (_id, rpc) => rpc === id,
      async () => {
        turns.admit(grant);
        event("agent/inbox/spliced", { inserted: [msg(id)] });
      },
    );
  return {
    grant,
    agent,
    turns,
    msg,
    event,
    claim,
    enter,
    step,
    submit,
    expose,
    remove,
  };
}

describe("message-scoped source access", () => {
  it.each([undefined, "2026-01-02T03:04:05.000Z"])(
    "returns a verified link with modification time %s when provided",
    async (modifiedAt) => {
      const h = setup();
      const path = "folder/report draft.txt";
      h.grant.binding.linkBase = "https://archive.example.test/documents/";
      await h.submit("picked");
      await h.step(h.msg("picked"));
      const perform = vi.fn().mockResolvedValue({
        path,
        ...(modifiedAt === undefined ? {} : { modifiedAt }),
      });
      try {
        const tool = sourceTool(
          h.turns,
          { perform } as unknown as ArchiveGateway,
          { info: vi.fn() } as unknown as PluginLogger,
        );
        const answer = await tool.execute({ action: "link", path }, {
          agent: h.agent,
          signal: new AbortController().signal,
        } as Parameters<typeof tool.execute>[1]);
        expect(perform).toHaveBeenCalledWith(
          expect.objectContaining({ action: "link", path }),
          h.grant.verify,
          expect.any(AbortSignal),
        );
        expect(JSON.parse(answer as string)).toEqual({
          name: "report draft.txt",
          path,
          kind: "file",
          source: "Demo",
          ...(modifiedAt === undefined ? {} : { modifiedAt }),
          address:
            "https://archive.example.test/documents/folder/report%20draft.txt",
        });
      } finally {
        h.turns.dispose();
      }
    },
  );

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
    const picked = h.msg("picked");
    h.claim(picked);
    expect(h.expose).toHaveBeenCalledExactlyOnceWith(h.agent);
    expect(h.turns.has(h.agent)).toBe(false);
    await h.enter(picked);
    const active = h.turns.current(h.agent);
    expect(active.grant).toBe(h.grant);
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
