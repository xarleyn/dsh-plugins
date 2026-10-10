import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { QaChatSharingStore } from "./store.js";
import type { QaEffectiveCapabilityPolicy } from "../types.js";
import { SessionId } from "@deepseek-ai/dsh-session/types";

interface Actor { userId: string; revision: number; tools: ReadonlySet<string> }
/** A mixed batch receives the intersection, never the union, of actor rights. */
export class QaChatTurnGuard {
  private readonly actors = new Map<string, { turn: number; actors: Actor[] }>();
  private readonly disposers: (() => void)[] = [];
  constructor(private readonly ctx: Context, private readonly store: () => QaChatSharingStore,
    private readonly policy: (userId: string, sessionId: string) => Promise<QaEffectiveCapabilityPolicy>,
    private readonly enabled: () => boolean = () => true,
    private readonly resourceSafe: (tool: string) => boolean = () => false) {
    this.disposers.push(ctx.on("agent/inbox/inserted", ({ agent, message }) => {
      if (!this.enabled()) return;
      const requestId = (message.source as { rpcId?: string }).rpcId;
      if (requestId === undefined) return;
      const id = String(agent.session.id);
      const actor = this.store().requestActor(id, requestId);
      if (actor?.revision !== undefined && actor.revision !== null &&
        !this.store().actorStillAllowed(id, actor.userId, actor.revision)) agent.inbox.remove(message.id);
    }, { global: true }));
    this.disposers.push(ctx.on("agent/pre-step", async ({ agent, turn }, next) => {
      if (!this.enabled()) return next();
      const decision = await next();
      if (decision.kind === "reject") return decision;
      const id = String(agent.session.id);
      const participants: Actor[] = this.actors.get(id)?.turn === turn ? [...(this.actors.get(id)?.actors ?? [])] : [];
      const admitted = [...decision.messages];
      for (const message of decision.messages) {
        const source = message.source as { rpcId?: string };
        if (source.rpcId === undefined) continue;
        const actor = this.store().requestActor(id, String(source.rpcId));
        if (actor?.revision === null || actor === undefined) continue;
        if (!this.store().actorStillAllowed(id, actor.userId, actor.revision)) {
          admitted.splice(admitted.indexOf(message), 1); continue;
        }
        if (participants.some(item => item.userId === actor.userId && item.revision === actor.revision)) continue;
        try {
          const ceiling = await this.policy(actor.userId, id);
          participants.push({ userId: actor.userId, revision: actor.revision,
            // Grantable tools require their own activation. Sharing grants none.
            tools: new Set(ceiling.tools) });
        } catch { admitted.splice(admitted.indexOf(message), 1); }
      }
      this.actors.set(id, { turn, actors: participants });
      if (decision.messages.length > 0 && admitted.length === 0) return { kind: "reject" };
      if (participants.some(actor => !this.store().actorStillAllowed(id, actor.userId, actor.revision)))
        return { kind: "reject" };
      return { ...decision, messages: admitted };
    }, { global: true }));
    this.disposers.push(ctx.tools.guard(execution => {
      if (execution.agent === undefined) return undefined;
      const actors = this.participants(execution.agent);
      for (const actor of actors) {
        const root = this.root(execution.agent);
        if (!this.store().actorStillAllowed(root, actor.userId, actor.revision))
          return "Shared chat access was revoked.";
        if (!actor.tools.has(execution.name)) return "This tool is outside the participant's own permissions.";
        // Personal filesystem, credentials and skill/command activation cannot
        // be delegated just by typing a message into someone else's chat.
        if (/^(?:read|write|edit|glob|grep|ls|bash|shell|exec|str_replace_editor|skill|skills_|command|delegate|subagent|agent_|document_|qa_file_delete)/u.test(execution.name))
          return "Shared participation does not grant the owner's filesystem or agent capabilities.";
        // A tool name's permission ceiling cannot confine an arbitrary plugin
        // body to published files. Unknown implementations fail closed until
        // an independently audited stateless/resource-scoped adapter exists.
        if (!this.resourceSafe(execution.name)) return "This tool has no shared-chat resource boundary.";
      }
      return undefined;
    }));
    this.disposers.push(ctx.on("agent/request", async ({ agent }, next) => {
      for (const actor of this.participants(agent)) {
        if (!this.store().actorStillAllowed(this.root(agent), actor.userId, actor.revision))
          throw new Error("Shared chat access was revoked.");
      }
      return next();
    }, { global: true }));
    this.disposers.push(ctx.on("agent/disposed", ({ agent }) => this.actors.delete(String(agent.session.id)), { global: true }));
  }
  private root(agent: Agent): string {
    let session = agent.session;
    const seen = new Set<string>();
    while (session.header.origin === "subagent" && session.header.parentSession !== undefined) {
      const id = String(session.id); if (seen.has(id)) break; seen.add(id);
      const parent = this.ctx.sessions.get(session.header.parentSession); if (parent === undefined) break;
      session = parent;
    }
    return String(session.id);
  }
  private participants(agent: Agent): readonly Actor[] { return this.actors.get(this.root(agent))?.actors ?? []; }
  collaborative(sessionId: string): boolean { return (this.actors.get(sessionId)?.actors.length ?? 0) > 0; }
  /** Called after permission mutation. Only a turn carrying stale input stops. */
  revoke(sessionId: string): void {
    const agent = this.ctx.agents.get(SessionId(sessionId));
    for (const message of [...(agent?.inbox.nextTurn ?? []), ...(agent?.inbox.nextStep ?? [])]) {
      const requestId = (message.source as { rpcId?: string }).rpcId;
      const actor = requestId === undefined ? undefined : this.store().requestActor(sessionId, requestId);
      if (actor !== undefined && actor.revision !== null && !this.store().actorStillAllowed(sessionId, actor.userId, actor.revision))
        agent?.inbox.remove(message.id);
    }
    const current = this.actors.get(sessionId);
    if (current?.actors.some(actor => !this.store().actorStillAllowed(sessionId, actor.userId, actor.revision)))
      this.ctx.sessionController.cancel({ sessionId: SessionId(sessionId) });
  }
  dispose(): void { for (const dispose of this.disposers.splice(0).reverse()) dispose(); this.actors.clear(); }
}
