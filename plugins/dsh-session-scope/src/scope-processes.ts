import {
  SESSION_SCOPE_ERROR,
  SESSION_SCOPE_EVENT,
} from "./session-scope.js";

export const SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE =
  `${SESSION_SCOPE_ERROR.PROCESS_ACTIVE}: close persistent terminals and stop background shell jobs before changing scope`;

export interface ScopeProcessOwner {
  session: unknown;
  ctx: {
    on(
      event: string,
      listener: (...args: any[]) => unknown,
      options?: Record<string, unknown>,
    ): unknown;
  };
}

export interface ScopeProcessJob {
  kind?: string;
  status?: string;
}

export interface ScopeProcessServices {
  terminals?: {
    hasOwnerActivity(owner: ScopeProcessOwner): boolean;
  };
  jobs?: {
    list(owner: ScopeProcessOwner): readonly ScopeProcessJob[];
  };
}

type ScopeProcessFenceState = ScopeProcessServices;

const PROCESS_TOOL_NAMES = new Set(["bash", "terminal_open"]);
const LIVE_JOB_KINDS = new Set(["bash", "pty-send"]);
const LIVE_JOB_STATUSES = new Set(["running", "stopping"]);

/**
 * Tracks process launches which can retain an old isolated mount view and
 * rejects scope changes until every such view has gone away.
 */
export class SessionScopeProcessActivity {
  readonly #activeExecutions = new WeakMap<ScopeProcessOwner, number>();
  readonly #fences = new WeakMap<ScopeProcessOwner, ScopeProcessFenceState>();

  isProcessTool(name: string): boolean {
    return PROCESS_TOOL_NAMES.has(name);
  }

  ensureFence(owner: ScopeProcessOwner, services: ScopeProcessServices): void {
    const existing = this.#fences.get(owner);
    if (existing !== undefined) {
      existing.terminals = services.terminals ?? existing.terminals;
      existing.jobs = services.jobs ?? existing.jobs;
      return;
    }

    const state: ScopeProcessFenceState = { ...services };
    this.#fences.set(owner, state);
    owner.ctx.on("internal/dispatch", (_mode, eventName, args) => {
      if (eventName !== "session/event") return;
      const [session, event] = args as [unknown, { type?: string } | undefined];
      if (session !== owner.session || event?.type !== SESSION_SCOPE_EVENT) return;
      if (!this.hasActive(owner, state)) return;
      throw new Error(SESSION_SCOPE_PROCESS_ACTIVE_MESSAGE);
    }, { global: true });
  }

  hasActive(owner: ScopeProcessOwner, services: ScopeProcessServices = {}): boolean {
    if ((this.#activeExecutions.get(owner) ?? 0) > 0) return true;

    try {
      if (services.terminals?.hasOwnerActivity(owner)) return true;
    } catch {
      return true;
    }

    try {
      const jobs = services.jobs?.list(owner) ?? [];
      return jobs.some((job) =>
        LIVE_JOB_KINDS.has(job.kind ?? "")
        && LIVE_JOB_STATUSES.has(job.status ?? ""));
    } catch {
      return true;
    }
  }

  async run<T>(owner: ScopeProcessOwner | undefined, toolName: string, operation: () => T | Promise<T>): Promise<T> {
    if (owner === undefined || !this.isProcessTool(toolName)) return operation();

    this.#activeExecutions.set(owner, (this.#activeExecutions.get(owner) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = (this.#activeExecutions.get(owner) ?? 1) - 1;
      if (remaining === 0) this.#activeExecutions.delete(owner);
      else this.#activeExecutions.set(owner, remaining);
    }
  }
}
