import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { QaChatTurnGuard } from "../../src/chat-sharing/turn-guard.js";
import { sharingFixture } from "./chat-sharing.helpers.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture() {
  const f = sharingFixture(); cleanup.push(() => f.store.storage.close());
  const callbacks = new Map<string, (...args: unknown[]) => unknown>();
  let toolGuard: (execution: { agent: Agent; name: string }) => string | undefined = () => undefined;
  const message = { id: "message-demo", source: { kind: "user", rpcId: "collab-request" }, role: "user", content: [{ type: "text", text: "Demo" }] };
  const inbox = { nextTurn: [message], nextStep: [], remove: vi.fn() };
  const agent = { session: { id: "chat-a", header: {} }, inbox } as unknown as Agent;
  const cancel = vi.fn();
  const ctx = { on: (event: string, callback: (...args: unknown[]) => unknown) => { callbacks.set(event, callback); return vi.fn(); },
    tools: { guard: (callback: typeof toolGuard) => { toolGuard = callback; return vi.fn(); } },
    sessions: { get: () => undefined }, agents: { get: () => agent }, sessionController: { cancel } } as unknown as Context;
  const access = f.store.write(f.collaborator.token, "chat-a"); f.store.recordAuthor(f.collaborator.token, access, "collab-request");
  const policy = vi.fn(async () => ({ tools: ["demo_safe_tool", "custom_file_reader", "read", "document_workflow_export"] }));
  const guard = new QaChatTurnGuard(ctx, () => f.store, policy as never, () => true, name => name === "demo_safe_tool"); cleanup.push(() => guard.dispose());
  const preStep = async () => callbacks.get("agent/pre-step")!({ agent, turn: 1, step: 1, messages: [message], signal: new AbortController().signal },
    async () => ({ kind: "enter", messages: [message] }));
  return { ...f, guard, callbacks, preStep, tool: (name: string) => toolGuard({ agent, name }), cancel, inbox, policy, agent, message };
}
describe("collaborator turn capabilities", () => {
  it("intersects base capabilities and refuses owner files, document mutation and grants", async () => {
    const f = fixture(); await f.preStep();
    expect(f.guard.collaborative("chat-a")).toBe(true);
    expect(f.tool("demo_safe_tool")).toBeUndefined();
    expect(f.tool("owner_only_tool")).toContain("participant");
    expect(f.tool("read")).toContain("filesystem");
    expect(f.tool("document_workflow_export")).toContain("filesystem");
    expect(f.tool("custom_file_reader")).toContain("resource boundary");
    expect(f.policy).toHaveBeenCalledWith(f.collaborator.user.id, "chat-a");
  });
  it("removes revoked queued input, cancels its running turn and refuses later tool executions", async () => {
    const f = fixture(); await f.preStep();
    f.store.set(f.owner.token, "chat-a", f.collaborator.user.email, null); f.guard.revoke("chat-a");
    expect(f.inbox.remove).toHaveBeenCalledWith("message-demo");
    expect(f.cancel).toHaveBeenCalledWith({ sessionId: "chat-a" });
    expect(f.tool("demo_safe_tool")).toContain("revoked");
  });
  it("drops a revoked message that races resume and refuses insertion after revoke", async () => {
    const f = fixture(); f.store.set(f.owner.token, "chat-a", f.collaborator.user.email, null);
    expect(await f.preStep()).toMatchObject({ kind: "reject" });
    await f.callbacks.get("agent/inbox/inserted")!({ agent: f.agent, message: f.message });
    expect(f.inbox.remove).toHaveBeenCalledWith("message-demo");
    expect(f.policy).not.toHaveBeenCalled();
  });
  it("does not cancel an unrelated owner turn when a different recipient loses access", () => {
    const f = fixture(); f.store.set(f.owner.token, "chat-a", f.reader.user.email, null); f.guard.revoke("chat-a");
    expect(f.cancel).not.toHaveBeenCalled(); expect(f.inbox.remove).not.toHaveBeenCalled();
  });
});
