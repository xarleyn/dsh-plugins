/**
 * Session and slot state machines (SPEC §18-§19).
 *
 * Pure state + transition helpers; the coordinator owns the transitions.
 * These types also back the status/diagnostics API (SPEC §47).
 */

/** Session-side lifecycle state (SPEC §18). */
export type SessionKvLifecycle =
  | "none"
  | "cold"
  | "restoring"
  | "active-clean"
  | "active-dirty"
  | "saving"
  | "saved"
  | "invalid";

/** Physical slot state (SPEC §19). */
export type SlotState =
  | "unknown"
  | "idle"
  | "restoring"
  | "ready"
  | "inference"
  | "dirty"
  | "saving"
  | "broken";

/** The one managed physical slot of v0.1 (SPEC §19, §7). */
export interface ManagedSlot {
  readonly id: number;
  /** Session that currently owns the slot, when any. */
  ownerSessionId: string | null;
  /** Dirty generation at the time the slot state was last established. */
  snapshotRevision: string | null;
  state: SlotState;
  lastUsedAt: number | null;
}

/** Runtime bookkeeping for one known session (SPEC §27-§28). */
export interface SessionRuntime {
  readonly sessionId: string;
  /** Route of the latest request (provider + model, SPEC §56). */
  route: { provider: string; model: string };
  /** Monotonic dirty generation: increments on every successful inference. */
  dirtyRevision: number;
  /** Generation covered by the latest durable snapshot. */
  persistedRevision: number;
  /** In-flight save for the current generation, when any (SPEC §27). */
  saveInFlight: Promise<SnapshotResult> | null;
  lifecycle: SessionKvLifecycle;
}

/** Result of a save operation (SPEC §11). */
export interface SnapshotResult {
  readonly kind: "saved" | "skipped-clean" | "skipped-not-owner" | "failed";
  readonly sessionId: string;
  readonly revision: number;
  readonly bytes: number | null;
  readonly error: string | null;
}

/** Result of a restore attempt (SPEC §23). */
export interface RestoreOutcome {
  readonly kind: "already-active" | "cold" | "restored" | "cold-fallback";
  readonly sessionId: string;
  readonly tokens: number | null;
  readonly bytes: number | null;
  readonly durationMs: number | null;
  readonly error: string | null;
}

export function createManagedSlot(id: number): ManagedSlot {
  return {
    id,
    ownerSessionId: null,
    snapshotRevision: null,
    state: "unknown",
    lastUsedAt: null,
  };
}

export function createSessionRuntime(
  sessionId: string,
  route: { provider: string; model: string },
): SessionRuntime {
  return {
    sessionId,
    route: { ...route },
    dirtyRevision: 0,
    persistedRevision: 0,
    saveInFlight: null,
    lifecycle: "none",
  };
}

/** Dirty in the generation sense (SPEC §28), not a boolean. */
export function isDirty(runtime: SessionRuntime): boolean {
  return runtime.dirtyRevision > runtime.persistedRevision;
}

/** Record a completed successful inference: bump the dirty generation. */
export function markDirty(runtime: SessionRuntime): void {
  runtime.dirtyRevision += 1;
  runtime.lifecycle = "active-dirty";
}

/** Record a durable snapshot covering `revision`. */
export function markPersisted(runtime: SessionRuntime, revision: number): void {
  runtime.persistedRevision = Math.max(runtime.persistedRevision, revision);
  runtime.lifecycle = isDirty(runtime) ? "active-dirty" : "saved";
}
