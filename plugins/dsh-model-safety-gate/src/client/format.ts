/**
 * Pure presentation helpers of the Safety Gate card.
 *
 * Kept out of the components so the number, mode, and endpoint wording is
 * unit-testable without a DOM, and so every place that renders the same value
 * renders it identically.
 */

import type { GateMode } from "../config.js";

/** Label and tone of the gate mode as the header badge and controls show it. */
export interface ModeLabel {
  readonly label: string;
  readonly tone: "off" | "audit" | "warn" | "enforce";
}

/** Wording of the mode chip; `undefined` values render the composition default. */
export function describeMode(mode: GateMode | undefined): ModeLabel {
  switch (mode) {
    case "off":
      return { label: "Off", tone: "off" };
    case "audit":
      return { label: "Audit", tone: "audit" };
    case "enforce":
      return { label: "Enforce", tone: "enforce" };
    case "warn":
      return { label: "Warn", tone: "warn" };
    default:
      return { label: "Warn", tone: "warn" };
  }
}

/** Badge text: the running mode, or that the whole gate is switched off. */
export function badgeText(enabled: boolean | undefined, mode: GateMode | undefined): string {
  if (enabled === false) return "Disabled";
  return describeMode(mode).label;
}

/** Group digits so long counter values stay readable. */
export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/** One decimal place, or a dash when there is nothing to average yet. */
export function formatAverage(totalMs: number | undefined, count: number | undefined): string {
  if (totalMs === undefined || count === undefined || count <= 0 || !Number.isFinite(totalMs)) return "—";
  return `${(totalMs / count).toFixed(1)} ms`;
}

/** Millisecond value with a unit that matches its magnitude. */
export function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

/** Uptime of the running gate, in at most two units. */
export function formatUptime(startedAt: number | undefined, now: number): string {
  if (startedAt === undefined || !Number.isFinite(startedAt) || now <= startedAt) return "—";
  const seconds = Math.floor((now - startedAt) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Content hashes are identifiers, not text: show a stable short prefix. */
export function shortHash(hash: string | undefined): string {
  if (hash === undefined || hash.length === 0) return "—";
  return hash.length <= 12 ? hash : `${hash.slice(0, 12)}…`;
}

/** Zero-width split point for rule ids and categories. */
export function joinList(values: readonly string[] | undefined): string {
  if (values === undefined || values.length === 0) return "—";
  return values.join(", ");
}

/**
 * Parse a numeric control's draft text.
 * @param text - raw input value.
 * @returns the number, or null when the field is empty or not numeric (the
 * caller leaves the stored value alone rather than writing a NaN).
 */
export function parseNumberDraft(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Parse a comma- or newline-separated list control's draft text. */
export function parseListDraft(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether the raw user layer carries this path, which is what marks a field
 * overridden — a value equal to the composition default is still an override.
 * @param user - raw user section from the settings snapshot.
 * @param path - path from the section root.
 * @returns true when every segment exists in the user layer.
 */
export function isOverridden(user: unknown, path: readonly string[]): boolean {
  let cursor: unknown = user;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return false;
    const record = cursor as Record<string, unknown>;
    if (!Object.hasOwn(record, segment)) return false;
    cursor = record[segment];
  }
  return true;
}

/** Top-level keys the user layer carries; the reset-all action clears exactly these. */
export function overriddenKeys(user: unknown): string[] {
  if (typeof user !== "object" || user === null || Array.isArray(user)) return [];
  return Object.keys(user as Record<string, unknown>).sort();
}

/**
 * Endpoint wording of the classifier as the privacy notice renders it. The
 * notice is a deployment obligation (design SPEC §22): content leaves the
 * process whenever the operator points the classifier at a remote endpoint.
 */
export function describeEndpoint(backend: string | undefined, endpoint: string | undefined): string {
  if (endpoint !== undefined && endpoint.length > 0) return endpoint;
  if (backend === "none") return "no classifier endpoint";
  return "the configured endpoint";
}
