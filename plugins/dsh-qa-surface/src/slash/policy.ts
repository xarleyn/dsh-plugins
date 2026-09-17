/**
 * Admission policy for one half of the slash catalog.
 *
 * The policy is name-based because the persisted config is: an operator writes
 * `generate-tkp`, never an internal id, and the same name means the same thing
 * on every Host restart. Names that cannot be a native skill or command name
 * are refused at config resolution rather than silently ignored at admission,
 * so a typo surfaces while the deployment is being configured.
 */

import type { QaSlashPolicyMode } from "../types.js";

/** Every accepted policy mode, in the order the settings card lists them. */
export const QA_SLASH_MODES: readonly QaSlashPolicyMode[] = Object.freeze([
  "deny-all",
  "allow-list",
  "all",
]);

/**
 * Union of the two native name grammars: the command registry allows `_` and
 * a leading digit-bearing word, skills are kebab-case. A name outside this
 * shape can never be resolved by either registry.
 */
const SLASH_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

/** Longest name either registry accepts in practice; keeps host echoes bounded. */
export const QA_SLASH_NAME_MAX = 200;

export interface QaSlashPolicy {
  readonly mode: QaSlashPolicyMode;
  readonly allow: readonly string[];
}

export function isQaSlashPolicyMode(
  value: unknown,
): value is QaSlashPolicyMode {
  return value === "deny-all" || value === "allow-list" || value === "all";
}

/**
 * Normalize one allow-list: trimmed, deduplicated, order-preserving. Refuses
 * a name that neither registry could ever carry, and refuses `all` alongside a
 * non-empty list, which would be two answers to one question.
 */
export function normalizeSlashAllow(
  values: readonly string[],
  label: string,
): readonly string[] {
  const names = [...new Set(values.map((value) => value.trim()))].filter(
    (value) => value !== "",
  );
  for (const name of names) {
    if (name.length > QA_SLASH_NAME_MAX) {
      throw new TypeError(
        `dsh-qa-surface: ${label} names must be at most ${String(QA_SLASH_NAME_MAX)} characters`,
      );
    }
    if (!SLASH_NAME.test(name)) {
      throw new TypeError(
        `dsh-qa-surface: ${label} admits only lowercase native names (got "${name}")`,
      );
    }
  }
  return Object.freeze(names);
}

/** Whether the policy admits this native name. */
export function allowsSlashName(policy: QaSlashPolicy, name: string): boolean {
  if (policy.mode === "deny-all") return false;
  if (policy.mode === "all") return true;
  return policy.allow.includes(name);
}

/** The admitted subset, in the order the native registry returned it. */
export function filterBySlashPolicy<T extends { readonly name: string }>(
  entries: readonly T[],
  policy: QaSlashPolicy,
): readonly T[] {
  if (policy.mode === "deny-all") return Object.freeze([]);
  if (policy.mode === "all") return entries;
  const allowed = new Set(policy.allow);
  return Object.freeze(entries.filter((entry) => allowed.has(entry.name)));
}

/**
 * Intersect an already-admitted list with a second name set (the session's
 * role grant). An empty set means "no second opinion" — the role system keeps
 * its own switch, and a deployment that never enabled it grants nothing here.
 */
export function intersectSlashNames<T extends { readonly name: string }>(
  entries: readonly T[],
  names: readonly string[] | undefined,
): readonly T[] {
  if (names === undefined) return entries;
  const granted = new Set(names);
  return Object.freeze(entries.filter((entry) => granted.has(entry.name)));
}
