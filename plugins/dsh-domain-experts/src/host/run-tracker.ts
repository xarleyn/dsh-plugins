import type { MemoryOwner } from "./resolver.js";

/** Identity and memory ownership retained for a child, including after settlement. */
export interface ActiveRun {
  readonly domainId: string;
  readonly childSessionId: string;
  readonly callerSessionId: string;
  readonly callerDomain: string | null;
  readonly path: readonly string[];
  readonly depth: number;
  readonly background: boolean;
  readonly maxParallel: number;
  /** A resumed child inherits this owner; its own session is not account-attested. */
  readonly memoryOwner: MemoryOwner;
}

/**
 * A bounded identity catalog and an independent in-flight permit ledger.
 * Identity survives settlement for resumed children, while permits include
 * pending starts and are never evicted with old identities. After identity
 * eviction/restart the Host catalog can recover lineage, but not memory ownership.
 */
export class RunTracker {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly active = new Map<string, number>();
  private readonly limit: number;

  constructor(limit = 512) {
    this.limit = Math.max(1, Math.trunc(limit));
  }

  register(run: ActiveRun): void {
    this.runs.delete(run.childSessionId);
    this.runs.set(run.childSessionId, run);
    while (this.runs.size > this.limit) {
      const oldest = this.runs.keys().next();
      if (oldest.done === true) break;
      this.runs.delete(oldest.value);
    }
  }

  /** Forget identity explicitly; activation settlement only releases its permit. */
  release(childSessionId: string): void {
    this.runs.delete(childSessionId);
  }

  find(sessionId: string): ActiveRun | undefined {
    return this.runs.get(sessionId);
  }

  /** Atomically reserve capacity before any async resolution/start work. */
  reserve(callerSessionId: string, limit: number): (() => void) | undefined {
    const active = this.countForCaller(callerSessionId);
    if (limit > 0 && active >= limit) return undefined;
    this.active.set(callerSessionId, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = this.countForCaller(callerSessionId) - 1;
      if (remaining > 0) this.active.set(callerSessionId, remaining);
      else this.active.delete(callerSessionId);
    };
  }

  countForCaller(callerSessionId: string): number {
    return this.active.get(callerSessionId) ?? 0;
  }

  get size(): number {
    return this.runs.size;
  }
}
