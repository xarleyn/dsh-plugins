/**
 * In-memory audit ring (`SPEC.md`, "Audit"). Records the decision metadata —
 * never prompt or response text. Phase 1 keeps it process-local; durable
 * replay arrives with Phase 2 persistence.
 */

import type { ReviewAuditEntry } from "./types.js";

/** Bounded audit ring plus the cheap counters the metrics backlog wants. */
export class ReviewAudit {
  private readonly entries: ReviewAuditEntry[] = [];
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  resize(capacity: number): void {
    this.capacity = capacity;
    if (this.entries.length > capacity) {
      this.entries.splice(0, this.entries.length - capacity);
    }
  }

  record(entry: ReviewAuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  /** Newest last (diagnostics/tests). */
  list(): readonly ReviewAuditEntry[] {
    return [...this.entries];
  }
}
