/**
 * Whether the audit provider is present, as a client-side service.
 *
 * The audit plugin may or may not be installed, and its Remote namespace
 * arrives asynchronously. A React tree cannot watch a Cordis injection by
 * itself, so the attach/detach pair below is exposed as an external store and
 * the surface reads it with `useSyncExternalStore` — the same shape the rest
 * of this client uses for host-driven state.
 */
import type { QaAuditApi } from "./types.js";

/** The snapshot the surface renders from; replaced, never mutated. */
export interface QaAuditSnapshot {
  readonly api: QaAuditApi | null;
}

const DETACHED: QaAuditSnapshot = { api: null };

export class QaAuditController {
  private snapshot: QaAuditSnapshot = DETACHED;
  private readonly listeners = new Set<() => void>();

  /** The provider's namespace resolved: audits become visible. */
  attach(api: QaAuditApi): void {
    this.snapshot = { api };
    this.emit();
  }

  /** The provider went away: the badge and the dialog disappear with it. */
  detach(): void {
    if (this.snapshot === DETACHED) return;
    this.snapshot = DETACHED;
    this.emit();
  }

  getSnapshot = (): QaAuditSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispose(): void {
    this.listeners.clear();
    this.snapshot = DETACHED;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A subscriber's failure is the subscriber's.
      }
    }
  }
}
