/**
 * Comparison artifact writer (§22, §23).
 *
 * A comparison is an artifact bundle with the same anatomy as every other one —
 * a directory under the artifact root, a `manifest.json` that says what it is —
 * plus one extra promise: it can be re-read. The change set goes to disk as JSON
 * Lines, one change per line, so `document_diff_read` can page through a
 * hundred-page contract without holding it in memory, and so a person can grep
 * the answer.
 */

import path from "node:path";

import { buildManifest, writeManifest } from "../../artifacts/manifest.js";
import type { ArtifactStore } from "../../artifacts/store.js";
import { serializeCanonicalDocument } from "../canonical/document-ir.js";
import type { CanonicalDocument } from "../canonical/document-ir.js";
import { renderComparisonReport } from "../report.js";
import type {
  ComparisonOptions,
  ComparisonQuality,
  ComparisonSummary,
  DocumentChange,
} from "../types.js";
import type {
  DocumentComparisonRecord,
  DocumentComparisonSide,
  DocumentFormat,
  DocumentManifest,
  DocumentWarning,
} from "../../types.js";

/** Engine identity recorded in the manifest; bump when the diff changes. */
export const DIFF_ENGINE = "document-diff-v1";

export interface ComparisonSideRecord {
  readonly filename: string;
  readonly sha256: string;
  readonly format: DocumentFormat | "unknown";
  /** Extension of the retained copy, without the dot. */
  readonly extension: string;
  readonly rawBytes: Buffer;
  readonly document: CanonicalDocument;
}

export interface WriteComparisonInput {
  readonly store: ArtifactStore;
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly left: ComparisonSideRecord;
  readonly right: ComparisonSideRecord;
  readonly options: ComparisonOptions;
  readonly quality: ComparisonQuality;
  readonly summary: ComparisonSummary;
  readonly changes: readonly DocumentChange[];
  readonly retainInputs: boolean;
  readonly retainNormalized: boolean;
  readonly scope: { readonly sessionId?: string; readonly workspace?: string };
  readonly warnings: readonly DocumentWarning[];
}

export interface WrittenComparison {
  readonly manifestPath: string;
  readonly changesPath: string;
  readonly reportPath: string;
  readonly retained: { readonly left?: string; readonly right?: string };
  readonly normalized: { readonly left?: string; readonly right?: string };
}

export async function writeComparisonArtifact(
  input: WriteComparisonInput,
): Promise<WrittenComparison> {
  const store = input.store;
  const bundle = input.comparisonId;
  const retained: { left?: string; right?: string } = {};
  const normalized: { left?: string; right?: string } = {};

  if (input.retainInputs) {
    retained.left = await copySide(store, bundle, "left", input.left);
    retained.right = await copySide(store, bundle, "right", input.right);
  }
  if (input.retainNormalized) {
    normalized.left = (
      await store.write(
        path.join(bundle, "normalized", "left.json"),
        serializeCanonicalDocument(input.left.document),
      )
    ).path;
    normalized.right = (
      await store.write(
        path.join(bundle, "normalized", "right.json"),
        serializeCanonicalDocument(input.right.document),
      )
    ).path;
  }

  const changesFile = path.join(bundle, "diff", "changes.jsonl");
  const changesWritten = await store.write(
    changesFile,
    `${input.changes.map(serializeChange).join("\n")}\n`,
  );
  await store.write(
    path.join(bundle, "diff", "summary.json"),
    `${JSON.stringify(
      {
        comparisonId: bundle,
        createdAt: input.createdAt,
        left: sideSummary(input.left),
        right: sideSummary(input.right),
        quality: {
          level: input.quality.level,
          leftExtraction: input.quality.leftExtraction,
          rightExtraction: input.quality.rightExtraction,
          ocrUsed: input.quality.ocrUsed,
          reasons: [...input.quality.reasons],
        },
        options: input.options,
        summary: input.summary,
      },
      null,
      2,
    )}\n`,
  );
  const reportFile = path.join(bundle, "diff", "report.md");
  const reportWritten = await store.write(
    reportFile,
    renderComparisonReport({
      comparisonId: bundle,
      createdAt: input.createdAt,
      left: input.left,
      right: input.right,
      quality: input.quality,
      summary: input.summary,
      options: input.options,
      changes: input.changes,
    }),
  );

  const record: DocumentComparisonRecord = {
    left: sideRecord(input.left, retained.left),
    right: sideRecord(input.right, retained.right),
    engine: {
      extractorLeft: input.left.document.extractor,
      extractorRight: input.right.document.extractor,
      diff: DIFF_ENGINE,
    },
    options: { ...input.options },
    quality: {
      level: input.quality.level,
      reasons: [...input.quality.reasons],
      ocrUsed: input.quality.ocrUsed,
    },
    summary: {
      insertions: input.summary.insertions,
      deletions: input.summary.deletions,
      replacements: input.summary.replacements,
      moves: input.summary.moves,
      affectedSections: input.summary.affectedSections,
      total: input.summary.total,
    },
    changes: input.changes.length,
    changesPath: relative(store, changesWritten.path),
    reportPath: relative(store, reportWritten.path),
    ...(normalized.left === undefined || normalized.right === undefined
      ? {}
      : {
          normalized: {
            left: relative(store, normalized.left),
            right: relative(store, normalized.right),
          },
        }),
  };

  const manifest: DocumentManifest = {
    ...buildManifest({
      artifactId: bundle,
      operation: "document_compare",
      createdAt: input.createdAt,
      input: {
        format: input.left.format,
        sha256: input.left.sha256,
        filename: input.left.filename,
        bytes: input.left.rawBytes.length,
      },
      outputs: [
        {
          format: "md",
          path: path.basename(reportFile),
          sha256: reportWritten.sha256,
          size: reportWritten.size,
          status: "created",
        },
        {
          format: "md",
          path: path.basename(changesFile),
          sha256: changesWritten.sha256,
          size: changesWritten.size,
          status: "created",
        },
      ],
      backends: {
        left: { provider: input.left.document.extractor },
        right: { provider: input.right.document.extractor },
        diff: { provider: DIFF_ENGINE },
      },
      warnings: input.warnings,
      scope: input.scope,
    }),
    kind: "document-comparison",
    comparison: record,
  };
  const manifestPath = await writeManifest(store, bundle, manifest);

  return {
    manifestPath,
    changesPath: changesWritten.path,
    reportPath: reportWritten.path,
    retained,
    normalized,
  };
}

async function copySide(
  store: ArtifactStore,
  bundle: string,
  side: "left" | "right",
  record: ComparisonSideRecord,
): Promise<string> {
  const written = await store.write(
    path.join(bundle, "inputs", `${side}.${record.extension}`),
    record.rawBytes,
  );
  return written.path;
}

function sideSummary(record: ComparisonSideRecord): {
  readonly filename: string;
  readonly sha256: string;
  readonly format: string;
  readonly nodes: number;
  readonly counts: CanonicalDocument["counts"];
} {
  return {
    filename: record.filename,
    sha256: record.sha256,
    format: record.format,
    nodes: record.document.counts.nodes,
    counts: record.document.counts,
  };
}

function sideRecord(
  record: ComparisonSideRecord,
  retainedPath: string | undefined,
): DocumentComparisonSide {
  return {
    sha256: record.sha256,
    filename: record.filename,
    format: record.format,
    nodes: record.document.counts.nodes,
    ...(retainedPath === undefined
      ? {}
      : { retainedPath: path.basename(retainedPath) }),
  };
}

function relative(store: ArtifactStore, absolute: string): string {
  return path.relative(store.root, absolute).split(path.sep).join("/");
}

/**
 * One change, one line (§22). Field order is fixed so the file is byte-stable
 * for a given change set — the determinism test hashes it.
 */
export function serializeChange(change: DocumentChange): string {
  return JSON.stringify({
    id: change.id,
    kind: change.kind,
    nodeType: change.nodeType,
    ...(change.left === undefined
      ? {}
      : { left: serializeLocation(change.left) }),
    ...(change.right === undefined
      ? {}
      : { right: serializeLocation(change.right) }),
    ...(change.before === undefined ? {} : { before: change.before }),
    ...(change.after === undefined ? {} : { after: change.after }),
    ...(change.spans === undefined
      ? {}
      : {
          spans: change.spans.map((span) => ({
            kind: span.kind,
            text: span.text,
          })),
        }),
    context: {
      headingPath: [...change.context.headingPath],
      ...(change.context.previous === undefined
        ? {}
        : { previous: change.context.previous }),
      ...(change.context.next === undefined
        ? {}
        : { next: change.context.next }),
    },
    signals: [...change.signals],
    confidence: change.confidence,
  });
}

export function serializeLocation(location: {
  readonly part: string;
  readonly nodeIndex: number;
  readonly headingPath: readonly string[];
  readonly paragraph?: number;
  readonly page?: number;
  readonly table?: number;
  readonly row?: number;
  readonly column?: number;
  readonly xmlPath?: string;
}): Record<string, unknown> {
  return {
    part: location.part,
    nodeIndex: location.nodeIndex,
    headingPath: [...location.headingPath],
    ...(location.paragraph === undefined
      ? {}
      : { paragraph: location.paragraph }),
    ...(location.page === undefined ? {} : { page: location.page }),
    ...(location.table === undefined ? {} : { table: location.table }),
    ...(location.row === undefined ? {} : { row: location.row }),
    ...(location.column === undefined ? {} : { column: location.column }),
    ...(location.xmlPath === undefined ? {} : { xmlPath: location.xmlPath }),
  };
}
