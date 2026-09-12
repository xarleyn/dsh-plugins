import type { ExpertAuditEntry } from "../types.js";

/**
 * Bounded in-memory audit ring (design §33).
 *
 * Records execution metadata only: never a task text, retrieved memory or a
 * secret. Durable audit storage is a Phase 2 concern; the ring exists so the
 * cross-domain delegation trail is visible in the UI without a new table, and
 * every record is mirrored to the plugin log for anything longer-lived.
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
