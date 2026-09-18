/**
 * Stable change identifiers (§24).
 *
 * Every conclusion the semantic layer draws has to be traceable back to a fact,
 * so a change id must survive a repeated run of the same comparison: the same
 * two documents compared twice must produce the same `chg_…` for the same edit,
 * or a report cannot cite anything. The digest therefore covers only what
 * defines the edit — the two inputs, the place, and the before/after texts —
 * and never a timestamp, a run id or an ordering.
 */

import { createHash } from "node:crypto";

export interface ChangeIdParts {
  readonly leftSha: string;
  readonly rightSha: string;
  readonly part: string;
  readonly kind: string;
  readonly before?: string;
  readonly after?: string;
  readonly leftIndex?: number;
  readonly rightIndex?: number;
  readonly cell?: {
    readonly table: number;
    readonly row: number;
    readonly column: number;
  };
}

const ID_LENGTH = 12;

export function createChangeId(parts: ChangeIdParts): string {
  const shape = [
    parts.leftSha,
    parts.rightSha,
    parts.part,
    parts.kind,
    parts.leftIndex ?? "",
    parts.rightIndex ?? "",
    parts.cell === undefined
      ? ""
      : `${parts.cell.table}:${parts.cell.row}:${parts.cell.column}`,
    parts.before ?? "",
    parts.after ?? "",
  ].join("\u0000");
  return `chg_${sha256(shape).slice(0, ID_LENGTH)}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
