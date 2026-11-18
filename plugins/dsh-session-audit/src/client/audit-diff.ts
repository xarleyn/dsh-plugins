import type { AuditFinding } from "@yadsh/dsh-audit-core";

const MAX_FINDINGS = 500;
const MAX_REPORT_CHARACTERS = 48 * 1024;
const MAX_REPORT_LINES = 300;

export type FindingChange =
  | { readonly kind: "added"; readonly finding: AuditFinding }
  | { readonly kind: "removed"; readonly finding: AuditFinding }
  | {
      readonly kind: "changed";
      readonly finding: AuditFinding;
      readonly fields: readonly (keyof AuditFinding)[];
      readonly previous: AuditFinding;
    };

function indexFindings(findings: readonly AuditFinding[]) {
  const entries = new Map<string, AuditFinding>();
  const ambiguous = new Set<string>();
  for (const finding of findings) {
    if (finding.id === "" || entries.has(finding.id)) ambiguous.add(finding.id);
    entries.set(finding.id, finding);
  }
  return { entries, ambiguous };
}

/** Match a finding only when its producer ID is unambiguous on both sides. */
export function diffFindings(
  before: readonly AuditFinding[],
  after: readonly AuditFinding[],
) {
  if (before.length > MAX_FINDINGS || after.length > MAX_FINDINGS) return null;
  const baseline = indexFindings(before);
  const current = indexFindings(after);
  const ambiguous = new Set([...baseline.ambiguous, ...current.ambiguous]);
  const changes: FindingChange[] = [];
  for (const [id, finding] of current.entries) {
    if (ambiguous.has(id)) continue;
    const previous = baseline.entries.get(id);
    if (previous === undefined) {
      changes.push({ kind: "added", finding });
      continue;
    }
    const fields = (Object.keys(finding) as (keyof AuditFinding)[]).filter(
      (field) =>
        JSON.stringify(finding[field]) !== JSON.stringify(previous[field]),
    );
    if (fields.length > 0)
      changes.push({ kind: "changed", finding, fields, previous });
  }
  for (const [id, finding] of baseline.entries) {
    if (!ambiguous.has(id) && !current.entries.has(id))
      changes.push({ kind: "removed", finding });
  }
  return {
    changes,
    skipped: [...before, ...after].filter((finding) =>
      ambiguous.has(finding.id),
    ).length,
  };
}

export interface ReportChange {
  readonly kind: "added" | "removed";
  readonly line: number;
  readonly text: string;
}

/** Changed lines with numbers from their respective documents. Cap the LCS matrix. */
export function diffReport(
  before: string,
  after: string,
): readonly ReportChange[] | null {
  if (before === after) return [];
  if (Math.max(before.length, after.length) > MAX_REPORT_CHARACTERS)
    return null;
  const lines = (text: string) => (text === "" ? [] : text.split(/\r?\n/u));
  const left = lines(before);
  const right = lines(after);
  if (Math.max(left.length, right.length) > MAX_REPORT_LINES) return null;

  const lcs = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        left[i] === right[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const changes: ReportChange[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      i++;
      j++;
    } else if (
      i < left.length &&
      (j === right.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)
    ) {
      changes.push({ kind: "removed", line: i + 1, text: left[i++]! });
    } else {
      changes.push({ kind: "added", line: j + 1, text: right[j++]! });
    }
  }
  return changes;
}
