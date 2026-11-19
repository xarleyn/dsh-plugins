import { createHash } from "node:crypto";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { QaSurfaceConfig } from "../types.js";

export type SourceBinding = NonNullable<
  QaSurfaceConfig["searchSources"]
>[number];

export interface SourceGrant {
  readonly binding: SourceBinding;
  readonly session: string;
  readonly actor: string;
  readonly role: string;
  readonly verify: () => Promise<void>;
}

interface Admission {
  readonly session: string;
  readonly match: (
    id: string,
    rpc: string | undefined,
    text: string,
  ) => boolean;
  grant?: SourceGrant;
  captured?: string;
  open: boolean;
}

export const sourceDenied = () =>
  new Error(
    "Для чтения источника выберите его в этом сообщении и проверьте доступ.",
  );

interface PendingSource {
  readonly grant: SourceGrant;
  readonly fingerprint: string;
}
function fingerprint(message: UserMessage) {
  return createHash("sha256")
    .update(JSON.stringify(message.content))
    .digest("base64");
}

export class SourceTurns {
  private readonly admission = new AsyncLocalStorage<Admission>();
  private readonly pending = new Map<string, Map<string, PendingSource>>();
  private readonly active = new Map<
    string,
    {
      agent: Agent;
      turn: number;
      request: string;
      grant: SourceGrant;
      end: AbortController;
      signal: AbortSignal;
    }
  >();
  private readonly stops: (() => void)[];

  constructor(ctx: Context) {
    this.stops = [
      ctx.on(
        "session/event",
        (session, event) => {
          const id = String(session.id);
          if (event.type === "turn/start" || event.type === "turn/end")
            this.cancel(id);
          if (event.type !== "agent/inbox/spliced") return;
          const scope = this.admission.getStore();
          for (const m of event.data.inserted) {
            const key = String(m.id);
            if (
              !scope?.open ||
              scope.session !== id ||
              !scope.grant ||
              scope.captured ||
              m.source.kind !== "user"
            )
              continue;
            const text = m.content
              .flatMap((p) => (p.type === "text" ? [p.text] : []))
              .join("\n");
            if (
              !scope.match(
                key,
                "rpcId" in m.source ? String(m.source.rpcId) : undefined,
                text,
              )
            )
              continue;
            const queue =
              this.pending.get(id) ?? new Map<string, PendingSource>();
            queue.set(key, { grant: scope.grant, fingerprint: fingerprint(m) });
            this.pending.set(id, queue);
            scope.captured = key;
          }
        },
        { global: true },
      ),
      ctx.on(
        "agent/pre-step",
        async ({ agent, turn, messages, signal }, next) => {
          const decision = await next();
          const id = String(agent.session.id);
          if (
            decision.kind === "reject" ||
            agent.session.header.origin === "subagent"
          )
            return decision;
          const human = messages.filter(
            (m) => m.source.kind === "user" || m.source.kind === "retry",
          );
          if (!human.length) return decision;
          this.cancel(id);
          const queue = this.pending.get(id);
          const m = human.length === 1 ? human[0] : undefined;
          const pending =
            m?.source.kind === "user" ? queue?.get(String(m.id)) : undefined;
          const grant =
            m && pending && pending.fingerprint === fingerprint(m)
              ? pending.grant
              : undefined;
          for (const message of human) queue?.delete(String(message.id));
          if (!queue?.size) this.pending.delete(id);
          if (
            grant &&
            m &&
            !signal.aborted &&
            decision.messages.some((row) => row.id === m.id)
          ) {
            const end = new AbortController();
            this.active.set(id, {
              agent,
              turn,
              grant,
              request: String(m.id),
              end,
              signal: AbortSignal.any([signal, end.signal]),
            });
          }
          return decision;
        },
        { global: true },
      ),
      ctx.on(
        "agent/disposed",
        ({ agent }) => this.forget(String(agent.session.id)),
        { global: true },
      ),
      ctx.on("session/disposed", (session) => this.forget(String(session.id)), {
        global: true,
      }),
    ];
  }

  async submit<T>(
    session: string,
    match: Admission["match"],
    run: () => Promise<T>,
  ): Promise<T> {
    const scope: Admission = { session, match, open: true };
    try {
      return await this.admission.run(scope, run);
    } catch (error) {
      if (scope.captured) {
        this.drop(session, scope.captured);
        if (this.active.get(session)?.request === scope.captured)
          this.cancel(session);
      }
      throw error;
    } finally {
      scope.open = false;
      delete scope.grant;
    }
  }

  admit(grant: SourceGrant) {
    const scope = this.admission.getStore();
    if (scope?.open && scope.session === grant.session) scope.grant = grant;
  }

  current(agent: Agent | undefined) {
    if (!agent) throw sourceDenied();
    const state = this.active.get(String(agent.session.id));
    if (!state || state.agent !== agent || state.signal.aborted)
      throw sourceDenied();
    return state;
  }

  /** Report the selected reader only while this agent still owns a live grant. */
  async available(agent: Agent) {
    try {
      const state = this.current(agent);
      await state.grant.verify();
      return this.current(agent) === state;
    } catch {
      return false;
    }
  }

  drop(session: string, id: string) {
    const q = this.pending.get(session);
    q?.delete(id);
    if (!q?.size) this.pending.delete(session);
  }

  cancel(session: string) {
    this.active.get(session)?.end.abort();
    this.active.delete(session);
  }

  private forget(session: string) {
    this.cancel(session);
    this.pending.delete(session);
  }

  dispose() {
    for (const stop of this.stops) stop();
    for (const id of this.active.keys()) this.cancel(id);
    this.pending.clear();
  }
}
