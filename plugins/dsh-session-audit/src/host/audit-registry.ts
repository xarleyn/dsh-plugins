/**
 * The in-memory registry.
 *
 * There is no database (SPEC §20). The filesystem is the source of truth, the
 * registry is derivable from it, and a restart rebuilds it with one scan. What
 * the registry adds over the filesystem is the part that is expensive to
 * recompute per query: which audits a session owns, which one of them is
 * active, and what changed since the last subscriber looked.
 *
 * It is keyed by session *and* by audit id from the start (SPEC §28): the
 * active audit is the newest valid one, but every valid one is retained, so
 * history is a presentation decision rather than a re-architecture.
 */
import type {
  AuditRecord,
  AuditRegistryEvent,
  AuditSummary,
} from "@yadsh/dsh-audit-core";

/** Newest-first ordering key: modified time, then id to break ties deterministically. */
function newerFirst(left: AuditRecord, right: AuditRecord): number {
  if (left.modifiedAt !== right.modifiedAt) {
    return left.modifiedAt < right.modifiedAt ? 1 : -1;
  }
  return left.auditId.localeCompare(right.auditId);
}

/** The summary an event carries, for a record that has one. */
function eventSummary(record: AuditRecord): AuditSummary | undefined {
  return record.status === "ready" ? record.summary : undefined;
}

export class AuditRegistry {
  private readonly records = new Map<string, AuditRecord>();
  private readonly bySession = new Map<string, Set<string>>();
  private readonly listeners = new Set<(event: AuditRegistryEvent) => void>();

  /** How many audits are registered, in every state. */
  get size(): number {
    return this.records.size;
  }

  /** Register or replace one audit, publishing what changed. */
  upsert(record: AuditRecord): void {
    const previous = this.records.get(record.auditId);

    if (previous?.sessionId !== undefined && previous.sessionId !== null) {
      this.bySession.get(previous.sessionId)?.delete(record.auditId);
    }

    this.records.set(record.auditId, record);
    if (record.sessionId !== null) {
      let ids = this.bySession.get(record.sessionId);
      if (ids === undefined) {
        ids = new Set();
        this.bySession.set(record.sessionId, ids);
      }
      ids.add(record.auditId);
    }

    if (previous === undefined) {
      // A pending audit is deliberately not a `created` event: it has nothing
      // to show, and a subscriber that refetches on it learns nothing.
      if (record.status === "ready") {
        this.emit({
          type: "created",
          auditId: record.auditId,
          ...this.scope(record),
        });
      } else if (record.status === "invalid") {
        this.emit({
          type: "invalid",
          auditId: record.auditId,
          ...this.scope(record),
        });
      }
      return;
    }

    if (record.status === "invalid" && previous.status !== "invalid") {
      this.emit({
        type: "invalid",
        auditId: record.auditId,
        ...this.scope(record),
      });
      return;
    }

    if (
      record.status === "ready" &&
      (previous.fingerprint !== record.fingerprint ||
        previous.status !== record.status ||
        previous.sessionId !== record.sessionId)
    ) {
      this.emit({
        type: "updated",
        auditId: record.auditId,
        ...this.scope(record),
      });
    }
  }

  /** Forget one audit, publishing the removal. */
  remove(auditId: string): AuditRecord | undefined {
    const previous = this.records.get(auditId);
    if (previous === undefined) return undefined;
    this.records.delete(auditId);
    if (previous.sessionId !== null) {
      const ids = this.bySession.get(previous.sessionId);
      ids?.delete(auditId);
      if (ids !== undefined && ids.size === 0) {
        this.bySession.delete(previous.sessionId);
      }
    }
    this.emit({
      type: "deleted",
      auditId,
      ...(previous.sessionId === null ? {} : { sessionId: previous.sessionId }),
    });
    return previous;
  }

  get(auditId: string): AuditRecord | undefined {
    return this.records.get(auditId);
  }

  /** Every audit bound to a session, newest first — invalid ones included. */
  listFor(sessionId: string): readonly AuditRecord[] {
    const ids = this.bySession.get(sessionId);
    if (ids === undefined) return [];
    const records: AuditRecord[] = [];
    for (const auditId of ids) {
      const record = this.records.get(auditId);
      if (record !== undefined) records.push(record);
    }
    return records.sort(newerFirst);
  }

  /**
   * The active audit for a session: the newest one that is actually viewable.
   *
   * An invalid newcomer does not displace a valid incumbent — a half-copied
   * re-audit must not blank the audit a user is reading.
   */
  activeFor(sessionId: string): AuditRecord | undefined {
    return this.listFor(sessionId).find((record) => record.status === "ready");
  }

  /**
   * Every audit no session view can show, newest first.
   *
   * A record with no bound session is exactly that: an artefact no session
   * claims (`unresolved`), or a directory that could not be read as an audit
   * (`invalid`). Both are held in the registry and neither appears in any
   * session's view (SPEC §2.3), so this is the only list that can tell an
   * operator the audits exist at all.
   */
  unattached(): readonly AuditRecord[] {
    const records: AuditRecord[] = [];
    for (const record of this.records.values()) {
      if (record.sessionId === null) records.push(record);
    }
    return records.sort(newerFirst);
  }

  /** Ids of every registered audit. */
  auditIds(): readonly string[] {
    return [...this.records.keys()];
  }

  /** Counts for the plugin's own diagnostics. */
  counts(): {
    readonly ready: number;
    readonly invalid: number;
    readonly unresolved: number;
  } {
    let ready = 0;
    let invalid = 0;
    let unresolved = 0;
    for (const record of this.records.values()) {
      if (record.status === "ready") ready += 1;
      else if (record.status === "invalid") invalid += 1;
      else if (record.status === "unresolved") unresolved += 1;
    }
    return { ready, invalid, unresolved };
  }

  subscribe(listener: (event: AuditRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.records.clear();
    this.bySession.clear();
  }

  private scope(record: AuditRecord): {
    sessionId?: string;
    summary?: AuditSummary;
  } {
    const summary = eventSummary(record);
    return {
      ...(record.sessionId === null ? {} : { sessionId: record.sessionId }),
      ...(summary === undefined ? {} : { summary }),
    };
  }

  private emit(event: AuditRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A subscriber's failure is the subscriber's; the registry's job is to
        // hand the event to the next one.
      }
    }
  }
}
