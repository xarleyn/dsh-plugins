import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { QaQueueStatus } from "./types.js";

interface Waiting {
  readonly agent: Agent;
  readonly signal: AbortSignal;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly cancel: () => void;
}

/** A FIFO admission lease covers a complete root turn, including its experts. */
export class QaRequestScheduler {
  private readonly active = new Map<Agent, number>();
  private readonly waiting = new Map<Agent, Waiting>();
  private readonly completed: number[] = [];
  private readonly retiring = new Map<Agent, boolean>();
  private closed = false;

  constructor(
    private readonly limit: () => number,
    private readonly roots: () => readonly Agent[],
    private readonly now: () => number = Date.now,
    private readonly familyBusy: (agent: Agent) => boolean = () => false,
  ) {}

  install(ctx: Context): () => void {
    const guards = new Map<Agent, () => void>();
    const guard = async (
      { agent, signal }: { agent: Agent; signal: AbortSignal },
      next: () => Promise<import("@deepseek-ai/dsh-agent").PreStepDecision>,
    ) => {
      if (this.roots().includes(agent)) await this.acquire(agent, signal);
      signal.throwIfAborted();
      return next();
    };
    const attach = (agent: Agent) => {
      if (!this.roots().includes(agent) || guards.has(agent)) return;
      // Preset hooks (including automatic compaction) are composed before
      // agent/created. Prepend locally afterwards so they also wait for a slot.
      guards.set(
        agent,
        agent.ctx.on("agent/pre-step", guard, { prepend: true }),
      );
    };
    // A hot reload must account for work already running, without cancelling it.
    for (const agent of this.roots()) {
      if (agent.status === "running") this.active.set(agent, this.now());
      attach(agent);
    }
    const disposers = [
      ctx.on("agent/pre-step", guard, { global: true, prepend: true }),
      ctx.on(
        "agent/created",
        ({ agent }) => {
          attach(agent);
          return undefined;
        },
        { global: true },
      ),
      ctx.on(
        "session/event",
        (session, event) => {
          if (event.type !== "turn/end") return;
          for (const agent of this.active.keys()) {
            if (agent.session === session)
              this.release(agent, event.data.reason.kind === "completed");
          }
        },
        { global: true },
      ),
      ctx.on(
        "agent/status",
        ({ agent, status }) => {
          if (status === "idle") this.release(agent);
        },
        { global: true },
      ),
      ctx.on(
        "agent/disposed",
        ({ agent }) => {
          guards.get(agent)?.();
          guards.delete(agent);
          this.release(agent);
        },
        { global: true },
      ),
    ];
    // Volatile settings may raise the limit while every admitted turn is busy.
    const timer = setInterval(() => this.pump(), 1000);
    timer.unref();
    return () => {
      clearInterval(timer);
      for (const dispose of disposers) dispose();
      for (const dispose of guards.values()) dispose();
      this.dispose();
    };
  }

  acquire(agent: Agent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.closed)
      return Promise.reject(new Error("The request queue is unavailable."));
    if (this.active.has(agent)) {
      this.retiring.delete(agent);
      return Promise.resolve();
    }
    const existing = this.waiting.get(agent);
    if (existing) return existing.promise;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const cancel = () => {
      if (!this.waiting.delete(agent)) return;
      signal.removeEventListener("abort", cancel);
      reject(signal.reason);
      this.pump();
    };
    this.waiting.set(agent, {
      agent,
      signal,
      promise,
      resolve,
      reject,
      cancel,
    });
    signal.addEventListener("abort", cancel, { once: true });
    this.pump();
    return promise;
  }

  release(agent: Agent, completed = false): void {
    const started = this.active.get(agent);
    if (started !== undefined) {
      if (this.familyBusy(agent)) {
        this.retiring.set(
          agent,
          completed || this.retiring.get(agent) === true,
        );
        return;
      }
      completed ||= this.retiring.get(agent) === true;
      this.retiring.delete(agent);
      this.active.delete(agent);
      if (completed) {
        this.completed.push(Math.max(1, this.now() - started));
        if (this.completed.length > 20) this.completed.shift();
      }
    }
    const waiting = this.waiting.get(agent);
    if (waiting) {
      this.waiting.delete(agent);
      waiting.signal.removeEventListener("abort", waiting.cancel);
      waiting.reject(new Error("The queued request was cancelled."));
    }
    this.pump();
  }

  private pump(): void {
    if (this.closed) return;
    for (const [agent, completed] of this.retiring) {
      if (this.familyBusy(agent)) continue;
      this.retiring.delete(agent);
      const started = this.active.get(agent);
      this.active.delete(agent);
      if (completed && started !== undefined) {
        this.completed.push(Math.max(1, this.now() - started));
        if (this.completed.length > 20) this.completed.shift();
      }
    }
    const limit = this.limit();
    for (const [agent, entry] of this.waiting) {
      if (limit > 0 && this.active.size >= limit) break;
      this.waiting.delete(agent);
      entry.signal.removeEventListener("abort", entry.cancel);
      if (entry.signal.aborted) {
        entry.reject(entry.signal.reason);
        continue;
      }
      // Reserve synchronously before waking a driver: simultaneous prompts
      // cannot all observe the same free slot.
      this.active.set(agent, this.now());
      entry.resolve();
    }
  }

  status(sessionId?: string): QaQueueStatus {
    this.pump();
    const position =
      [...this.waiting.keys()].findIndex(
        (agent) => String(agent.session.id) === sessionId,
      ) + 1;
    const limit = this.limit();
    return {
      limit,
      active: this.active.size,
      full: limit > 0 && this.active.size >= limit,
      managed: true,
      queued: this.waiting.size,
      waiting: position > 0,
      position: position > 0 ? position : null,
      estimatedWaitMs: position > 0 ? this.estimate(position) : null,
    };
  }

  private estimate(position: number): number | null {
    // Never invent a duration before enough completed turns have been observed.
    if (this.completed.length < 3 || this.active.size === 0) return null;
    const duration =
      this.completed.reduce((sum, value) => sum + value, 0) /
      this.completed.length;
    const slots = [...this.active.values()].map((started) =>
      Math.max(1000, duration - (this.now() - started)),
    );
    let wait = 0;
    for (let n = 0; n < position; n++) {
      slots.sort((a, b) => a - b);
      wait = slots[0]!;
      slots[0] = wait + duration;
    }
    return Math.ceil(wait / 15000) * 15000;
  }

  dispose(): void {
    this.closed = true;
    for (const entry of this.waiting.values()) {
      entry.signal.removeEventListener("abort", entry.cancel);
      entry.reject(new Error("The request queue was unloaded."));
    }
    this.waiting.clear();
    this.active.clear();
    this.retiring.clear();
  }
}

/** Include background descendants whose root has already ended its own turn. */
export function qaRequestFamilyBusy(ctx: Context, root: Agent): boolean {
  const agents = ctx.agents.list();
  const family = new Set([root]);
  for (const owner of family) {
    for (const child of agents) {
      if (family.has(child) || !ctx.agents.isOwnedBy(child.id, owner)) continue;
      if (child.status === "running") return true;
      family.add(child);
    }
  }
  return false;
}

/** Older optional compositions may lack the registry, but cannot enforce a cap. */
export function qaRequestRoots(
  ctx: Context,
  required: boolean,
): readonly Agent[] {
  const registry = ctx.get("agents");
  if (typeof registry?.roots === "function") return registry.roots();
  if (required)
    throw new Error("The request queue requires the Host root-agent registry.");
  return [];
}
