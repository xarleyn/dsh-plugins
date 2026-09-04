import { Buffer } from "node:buffer";

const ELLIPSIS = "…";

export type TextBudgetUnit = "code-points" | "utf8-bytes";

function segmentSize(segment: string, unit: TextBudgetUnit): number {
  return unit === "code-points" ? 1 : Buffer.byteLength(segment, "utf8");
}

/**
 * Truncates text only between Unicode code points and includes the ellipsis in
 * the requested budget.
 */
export function truncateText(text: string, maxSize: number, unit: TextBudgetUnit): string {
  const ellipsisSize = segmentSize(ELLIPSIS, unit);
  if (maxSize < ellipsisSize) return "";

  const payloadLimit = maxSize - ellipsisSize;
  const prefix: string[] = [];
  let prefixSize = 0;
  let totalSize = 0;
  let prefixComplete = false;

  for (const codePoint of text) {
    const size = segmentSize(codePoint, unit);
    totalSize += size;
    if (!prefixComplete && prefixSize + size <= payloadLimit) {
      prefix.push(codePoint);
      prefixSize += size;
    } else {
      prefixComplete = true;
    }
  }

  return totalSize <= maxSize ? text : `${prefix.join("")}${ELLIPSIS}`;
}
