import type { ExpertAuditEntry } from "../types.js";

/**
 * Bounded in-memory audit ring (design §33).
 *
 * Records execution metadata only: never a task text, retrieved memory or a
 * secret. The ring exposes the current process's delegation trail. Host logs
 * and the optional execution archive receive separate projections.
 */
export class AuditRing {
  private readonly entries: ExpertAuditEntry[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = Math.max(1, Math.trunc(limit));
  }

  record(entry: ExpertAuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  /** Most recent first. */
  recent(limit = this.limit): readonly ExpertAuditEntry[] {
    const count = Math.max(0, Math.trunc(limit));
    if (count === 0) return [];
    return [...this.entries].reverse().slice(0, count);
  }

  clear(): void {
    this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }
}
