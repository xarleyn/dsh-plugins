import { createHash } from "node:crypto";

/**
 * Stable object-key ordering for schema and idempotency fingerprints.
 *
 * Lives apart from the sqlite store so every store implementation hashes the
 * same way without importing the sqlite bridge: the client test graph mounts a
 * store too, and a browser environment must not see `@yadsh/dsh-plugin-kit/sqlite`.
 */
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}
