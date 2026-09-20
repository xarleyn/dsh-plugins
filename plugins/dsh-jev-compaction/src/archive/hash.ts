/**
 * Content addressing for archived results (result-shaping SPEC §23).
 *
 * The hash is taken over a canonical serialization: keys sorted, only
 * JSON-representable data. Two runs of the same command that produce the same
 * rendered output therefore produce the same ref, which is what makes the
 * store deduplicate and what makes an integrity check possible when an entry
 * is read back.
 */

import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted, arrays left in order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(",")}}`;
}

/** `sha256:<hex>` over the canonical form of one archived payload. */
export function contentRef(payload: unknown): string {
  const digest = createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

/** The hex part of a `sha256:<hex>` ref, or the whole string when untyped. */
export function refHex(ref: string): string {
  const separator = ref.indexOf(":");
  return separator < 0 ? ref : ref.slice(separator + 1);
}

/** True for a well-formed `sha256:<64 hex>` reference. */
export function isArchiveRef(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}
