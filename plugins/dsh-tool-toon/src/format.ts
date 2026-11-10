import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { decode, encode } from "@toon-format/toon";
import type { ResolvedToolToonConfig } from "./config.js";

/** Restrict codec work and avoid JSON number normalization that loses data. */
function supported(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === "number") {
    return (
      Number.isFinite(value) &&
      !Object.is(value, -0) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    );
  }
  if (value === null || typeof value !== "object") return true;
  return Object.values(value).every((child) => supported(child, depth + 1));
}

/** Null means byte-identical bypass. The caller contains codec exceptions. */
export function formatJsonText(
  text: string,
  config: ResolvedToolToonConfig,
): string | null {
  const bytes = Buffer.byteLength(text, "utf8");
  if (
    bytes < config.minBytes ||
    bytes > config.maxBytes ||
    !["[", "{"].includes(text.trimStart()[0] ?? "")
  )
    return null;
  let value: unknown;
  try {
    value = JSON.parse(
      text,
      (_key: string, item: unknown, context?: { source?: string }) => {
        // Node >=22.19 supplies primitive source text. Be conservative about
        // number spellings so parsing cannot quietly round a high-precision value.
        if (
          typeof item === "number" &&
          context?.source !== JSON.stringify(item)
        )
          throw new Error("number normalization");
        return item;
      },
    );
  } catch {
    return null;
  }
  if (!supported(value)) return null;
  const encoded = encode(value);
  if (!isDeepStrictEqual(decode(encoded), value)) return null;
  let fenceLength = 3;
  for (const match of encoded.matchAll(/`+/gu))
    fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = "`".repeat(fenceLength);
  const candidate = `${fence}toon\n${encoded}\n${fence}`;
  const baseline = Math.min(
    bytes,
    Buffer.byteLength(JSON.stringify(value), "utf8"),
  );
  const outputBytes = Buffer.byteLength(candidate, "utf8");
  const savings = baseline - outputBytes;
  return savings >= config.minSavingsBytes &&
    savings / baseline >= config.minSavingsRatio
    ? candidate
    : null;
}
