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
interface ClaimedSource {
  readonly agent: Agent;
  readonly request: string | null;
  readonly disposeTool?: () => void;
}
function isHuman(message: UserMessage) {
  return message.source.kind === "user" || message.source.kind === "retry";
}
function fingerprint(message: UserMessage) {
  return createHash("sha256")
    .update(JSON.stringify(message.content))
    .digest("base64");
}

export class SourceTurns {
  private readonly admission = new AsyncLocalStorage<Admission>();
  private readonly pending = new Map<string, Map<string, PendingSource>>();
  private readonly claimed = new Map<string, ClaimedSource>();
  private readonly active = new Map<
    string,
    {
      agent: Agent;
      turn: number;
      request: string;
      grant: SourceGrant;
      end: AbortController;
      signal: AbortSignal;
      disposeTool?: () => void;
    }
  >();
  private readonly stops: (() => void)[];

  constructor(ctx: Context, exposeTool?: (agent: Agent) => () => void) {
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
        "agent/inbox/claimed",
        ({ agent, message }) => {
          if (!isHuman(message) || agent.session.header.origin === "subagent")
            return;
          const id = String(agent.session.id);
          const mixed = this.claimed.has(id);
          this.cancel(id);
          const request = String(message.id);
          const pending =
            !mixed && message.source.kind === "user"
              ? this.pending.get(id)?.get(request)
              : undefined;
          if (!pending || pending.fingerprint !== fingerprint(message)) {
            this.claimed.set(id, { agent, request: null });
            return;
          }
          // Harness resolves the executable tool set after claim and before
          // pre-step. Keep this registration until the same input settles.
          const disposeTool = exposeTool?.(agent);
          this.claimed.set(id, {
            agent,
            request,
            ...(disposeTool === undefined ? {} : { disposeTool }),
          });
        },
        { global: true },
      ),
      ctx.on(
        "agent/pre-step",
        async ({ agent, turn, messages, signal }, next) => {
          const id = String(agent.session.id);
          const claim = this.claimed.get(id);
          try {
            const decision = await next();
            if (agent.session.header.origin === "subagent") return decision;
            const human = messages.filter(isHuman);
            const queue = this.pending.get(id);
            const m = human.length === 1 ? human[0] : undefined;
            const pending =
              m?.source.kind === "user" ? queue?.get(String(m.id)) : undefined;
            for (const message of human) queue?.delete(String(message.id));
            if (!queue?.size) this.pending.delete(id);
            if (
              decision.kind === "reject" ||
              !m ||
              !pending ||
              pending.fingerprint !== fingerprint(m) ||
              claim?.agent !== agent ||
              claim.request !== String(m.id) ||
              !decision.messages.some((row) => row.id === m.id)
            )
              return decision;
            const { grant } = pending;
            try {
              await grant.verify();
            } catch {
              return decision;
            }
            if (signal.aborted || this.claimed.get(id) !== claim)
              return decision;
            const end = new AbortController();
            this.claimed.delete(id);
            this.active.set(id, {
              agent,
              turn,
              grant,
              request: String(m.id),
              end,
              signal: AbortSignal.any([signal, end.signal]),
              ...(claim.disposeTool === undefined
                ? {}
                : { disposeTool: claim.disposeTool }),
            });
            return decision;
          } finally {
            if (claim && this.claimed.get(id) === claim) this.discardClaim(id);
          }
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
        if (
          this.active.get(session)?.request === scope.captured ||
          this.claimed.get(session)?.request === scope.captured
        )
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

  has(agent: Agent | undefined): boolean {
    const state = agent && this.active.get(String(agent.session.id));
    return (
      state !== undefined && state.agent === agent && !state.signal.aborted
    );
  }

  /** The native skill injection belongs to the admitted user message in this batch. */
  matchesSkill(agent: Agent, name: string, messages: readonly UserMessage[]) {
    const human = messages.filter(isHuman);
    const message = human.length === 1 ? human[0] : undefined;
    if (message?.source.kind !== "user") return false;
    const id = String(agent.session.id);
    const request = String(message.id);
    const active = this.active.get(id);
    if (
      active?.agent === agent &&
      !active.signal.aborted &&
      active.request === request
    )
      return active.grant.binding.skill === name;
    const pending = this.pending.get(id)?.get(request);
    return (
      pending?.grant.binding.skill === name &&
      pending.fingerprint === fingerprint(message)
    );
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
    this.discardClaim(session);
    const state = this.active.get(session);
    this.active.delete(session);
    state?.end.abort();
    state?.disposeTool?.();
  }

  private discardClaim(session: string) {
    const claim = this.claimed.get(session);
    this.claimed.delete(session);
    claim?.disposeTool?.();
  }

  private forget(session: string) {
    this.cancel(session);
    this.pending.delete(session);
  }

  dispose() {
    for (const stop of this.stops) stop();
    for (const id of this.claimed.keys()) this.discardClaim(id);
    for (const id of this.active.keys()) this.cancel(id);
    this.pending.clear();
  }
}
