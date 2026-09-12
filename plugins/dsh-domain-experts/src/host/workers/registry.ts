import type { WorkerInfo } from "../../types.js";
import { DomainExpertsError } from "../errors.js";

const WORKER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/u;

/**
 * A functional worker (design §20).
 *
 * MVP workers are generic tool references: `tool` names the global tool the
 * worker maps onto, and `enforces` names the scope providers whose
 * restrictions that tool actually applies. The second field is what keeps the
 * UI honest — a path restriction is only "enforced" when a selected worker
 * claims it.
 */
export interface DomainWorker {
  readonly id: string;
  readonly title: string;
  readonly capabilities: readonly string[];
  readonly enforces: readonly string[];
  /** Global tool name, or `''` for a worker that is not a tool. */
  readonly tool: string;
  readonly builtin?: boolean;
}

export class WorkerRegistry {
  private readonly workers = new Map<string, DomainWorker>();

  register(worker: DomainWorker): () => void {
    if (!WORKER_ID_PATTERN.test(worker.id)) {
      throw new DomainExpertsError(
        "DOMAIN_INVALID",
        `Worker id "${worker.id}" must match ${String(WORKER_ID_PATTERN)}.`,
      );
    }
    if (this.workers.has(worker.id)) {
      throw new DomainExpertsError(
        "DOMAIN_INVALID",
        `Worker "${worker.id}" is already registered.`,
      );
    }
    this.workers.set(worker.id, worker);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.workers.get(worker.id) === worker) this.workers.delete(worker.id);
    };
  }

  get(id: string): DomainWorker | undefined {
    return this.workers.get(id);
  }

  list(): readonly DomainWorker[] {
    return [...this.workers.values()].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    );
  }

  info(): readonly WorkerInfo[] {
    return this.list().map((worker) => ({
      id: worker.id,
      title: worker.title,
      capabilities: worker.capabilities,
      enforces: worker.enforces,
      builtin: worker.builtin === true,
    }));
  }

  /**
   * Selected workers among the configured tool names. A worker counts as
   * selected when the domain allows either its id or its tool name.
   */
  selectedFor(allow: readonly string[], deny: readonly string[]): readonly DomainWorker[] {
    const allowed = new Set(allow);
    const denied = new Set(deny);
    return this.list().filter((worker) => {
      const selected = allowed.has(worker.id) || (worker.tool !== "" && allowed.has(worker.tool));
      if (!selected) return false;
      return !denied.has(worker.id) && (worker.tool === "" || !denied.has(worker.tool));
    });
  }

  /** Provider ids that at least one selected worker actually enforces. */
  enforcedProviders(selected: readonly DomainWorker[]): readonly string[] {
    const ids = new Set<string>();
    for (const worker of selected) {
      for (const provider of worker.enforces) ids.add(provider);
    }
    return [...ids].sort((left, right) => left.localeCompare(right, "en"));
  }

  /** Worker ids backing the enforced providers, for the inspector's evidence. */
  enforcersOf(selected: readonly DomainWorker[], providerId: string): readonly string[] {
    return selected
      .filter((worker) => worker.enforces.includes(providerId))
      .map((worker) => (worker.tool !== "" ? worker.tool : worker.id));
  }
}
