/**
 * The human-readable side of a comparison (§35).
 *
 * `report.md` is written without a model, from the same change set the tools
 * return, and it exists for the reasons a machine-readable file is not enough:
 * a reviewer reads it, a regression test diffs it, an operator debugs a diff
 * against it, and an auditor can tell that the artifact says what the answer
 * said. If the report and the model disagree, the report is right.
 */

import type { CanonicalDocument } from "./canonical/document-ir.js";
import type {
  ComparisonOptions,
  ComparisonPreviewEntry,
  ComparisonQuality,
  ComparisonSummary,
  DocumentChange,
} from "./types.js";

export interface ReportSide {
  readonly filename: string;
  readonly sha256: string;
  readonly document: CanonicalDocument;
}

export interface ReportInput {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly left: ReportSide;
  readonly right: ReportSide;
  readonly quality: ComparisonQuality;
  readonly summary: ComparisonSummary;
  readonly options: ComparisonOptions;
  readonly changes: readonly DocumentChange[];
}

const PART_LABELS: Readonly<Record<string, string>> = {
  body: "body",
  header: "header",
  footer: "footer",
  footnote: "footnote",
  comment: "comment",
};

/** Where a change happened, in the words a reviewer would use. */
export function locationLabel(change: DocumentChange): string {
  const location = change.right ?? change.left;
  if (location === undefined) return "(unknown location)";
  const parts: string[] = [];
  if (location.headingPath.length > 0) {
    parts.push(location.headingPath.join(" › "));
  } else {
    const part = PART_LABELS[location.part] ?? location.part;
    const detail =
      location.xmlPath === undefined || location.xmlPath === part
        ? ""
        : ` (${location.xmlPath})`;
    parts.push(
      location.paragraph === undefined
        ? `${part}${detail}`
        : `${part}${detail} ¶${location.paragraph}`,
    );
  }
  if (location.table !== undefined) {
    const coordinates = [`table ${location.table}`];
    if (location.row !== undefined) coordinates.push(`row ${location.row}`);
    if (location.column !== undefined) {
      coordinates.push(`column ${location.column}`);
    }
    parts.push(coordinates.join(", "));
  }
  if (change.kind === "move" && change.left !== undefined) {
    const from = locationLabel({ ...change, kind: "delete", right: undefined });
    return `${from} → ${parts.join(", ")}`;
  }
  return parts.join(", ");
}

/** The section a change belongs to, for grouping. */
function sectionLabel(change: DocumentChange): string {
  const location = change.right ?? change.left;
  if (location === undefined) return "(unknown location)";
  if (location.headingPath.length > 0) {
    return location.headingPath.join(" › ");
  }
  const part = PART_LABELS[location.part] ?? location.part;
  return part === "body" ? "(no heading)" : `(${part})`;
}

export function renderComparisonReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# Document comparison ${input.comparisonId}`);
  lines.push("");
  lines.push(
    `- left: \`${input.left.filename}\` — sha256 \`${input.left.sha256}\`, ${input.left.document.counts.nodes} nodes (${input.left.document.extractor})`,
  );
  lines.push(
    `- right: \`${input.right.filename}\` — sha256 \`${input.right.sha256}\`, ${input.right.document.counts.nodes} nodes (${input.right.document.extractor})`,
  );
  lines.push(
    `- quality: ${input.quality.level}${
      input.quality.reasons.length === 0
        ? ""
        : ` (${input.quality.reasons.join("; ")})`
    }`,
  );
  lines.push(
    `- options: detectMoves=${String(input.options.detectMoves ?? true)}, ignoreWhitespace=${String(input.options.ignoreWhitespace ?? true)}, ignoreFormatting=${String(input.options.ignoreFormatting ?? true)}`,
  );
  lines.push(
    `- changes: ${input.summary.total} (${input.summary.insertions} insertions, ${input.summary.deletions} deletions, ${input.summary.replacements} replacements, ${input.summary.moves} moves)`,
  );
  lines.push("");

  let currentSection: string | undefined;
  for (const change of input.changes) {
    const section = sectionLabel(change);
    if (section !== currentSection) {
      currentSection = section;
      lines.push(`## ${section}`);
      lines.push("");
    }
    lines.push(...renderChange(change));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderChange(change: DocumentChange): string[] {
  const lines: string[] = [];
  lines.push(
    `### ${change.id} — ${change.kind}${
      change.nodeType === "table-cell" || change.nodeType === "table-row"
        ? ` (${change.nodeType})`
        : ""
    }`,
  );
  lines.push("");
  lines.push(`Location: ${locationLabel(change)}`);
  if (change.confidence < 1) {
    lines.push(`Confidence: ${change.confidence}`);
  }
  lines.push("");
  if (change.before !== undefined) {
    lines.push("**Before**");
    lines.push("");
    lines.push(...quote(change.before));
    lines.push("");
  }
  if (change.after !== undefined) {
    lines.push("**After**");
    lines.push("");
    lines.push(...quote(change.after));
    lines.push("");
  }
  if (change.signals.length > 0) {
    lines.push(
      `Signals: ${change.signals.map((signal) => `\`${signal}\``).join(", ")}`,
    );
  }
  return lines;
}

function quote(text: string): string[] {
  return text.split("\n").map((line) => `> ${line}`);
}

/**
 * The bounded preview a comparison answers with (§6). It exists so the model
 * sees what the deterministic layer found before asking for anything, and so a
 * caller that only wants the shape of the change set never needs a second call.
 */
export function buildComparisonPreview(
  changes: readonly DocumentChange[],
  limit: number,
  charsPerChange: number,
): ComparisonPreviewEntry[] {
  return changes.slice(0, Math.max(0, limit)).map((change) => ({
    changeId: change.id,
    kind: change.kind,
    location: locationLabel(change),
    before: clip(change.before ?? "", charsPerChange),
    after: clip(change.after ?? "", charsPerChange),
    signals: change.signals,
  }));
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export { clip };
