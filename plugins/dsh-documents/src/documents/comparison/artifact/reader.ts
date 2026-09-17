/**
 * Comparison artifact reader (§7, §22).
 *
 * The second half of the pagination contract: `document_compare` wrote one
 * change per line, and this reads them back a page at a time with a filter on
 * top. A hundred-page contract must never arrive as one tool result, and a
 * follow-up question ("show me only the money changes in section 5") must not
 * re-parse either document.
 *
 * Reading streams the file: a filtered page is produced without holding the
 * whole change set in memory, and `remaining` is counted rather than guessed.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { readManifest } from "../../artifacts/manifest.js";
import type { ArtifactStore } from "../../artifacts/store.js";
import { DocumentError, asDocumentError } from "../../errors.js";
import { sha256Hex } from "../../artifacts/store.js";
import {
  CHANGE_KINDS,
  CHANGE_SIGNALS,
  SIGNAL_ALIASES,
  type ChangeKind,
  type ChangeSignal,
  type DocumentChange,
  type DocumentDiffReadInput,
  type DocumentDiffReadResult,
} from "../types.js";
import { isComparisonId } from "../../artifacts/ids.js";

export interface ReadComparisonOptions extends DocumentDiffReadInput {
  /** Page size when the caller names none. */
  readonly defaultLimit?: number;
  /** Hard ceiling on a page, whatever the caller asks for. */
  readonly maxLimit?: number;
}

interface NormalizedFilters {
  readonly kinds?: ReadonlySet<ChangeKind>;
  readonly signals?: ReadonlySet<ChangeSignal>;
  readonly section?: string;
}

export async function readComparisonChanges(
  store: ArtifactStore,
  options: ReadComparisonOptions,
): Promise<DocumentDiffReadResult> {
  const comparisonId = options.comparisonId;
  if (!isComparisonId(comparisonId)) {
    throw new DocumentError(
      "COMPARE_ARTIFACT_NOT_FOUND",
      `"${comparisonId}" is not a comparison id`,
    );
  }
  const manifest = await readManifest(store, comparisonId).catch(
    (error: unknown) => {
      throw new DocumentError(
        "COMPARE_ARTIFACT_NOT_FOUND",
        `the comparison ${comparisonId} was not found in this session's artifact root`,
        { cause: error },
      );
    },
  );
  const record = manifest.comparison;
  if (manifest.kind !== "document-comparison" || record === undefined) {
    throw new DocumentError(
      "COMPARE_ARTIFACT_NOT_FOUND",
      `${comparisonId} is a document artifact, not a comparison`,
    );
  }

  const filters = normalizeFilters(options.filters);
  const fingerprint = fingerprintOf(filters);
  const offset = decodeCursor(options.cursor, fingerprint);
  const limit = Math.min(
    Math.max(1, options.limit ?? options.defaultLimit ?? 20),
    options.maxLimit ?? 200,
  );

  const changes: DocumentChange[] = [];
  let matched = 0;
  let remaining = 0;
  const stream = createReadStream(store.path(record.changesPath), {
    encoding: "utf8",
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim() === "") continue;
      const change = parseChange(line);
      if (!matches(change, filters)) continue;
      if (matched < offset) {
        matched += 1;
        continue;
      }
      if (changes.length < limit) {
        changes.push(change);
        matched += 1;
        continue;
      }
      remaining += 1;
    }
  } catch (error) {
    throw asDocumentError(error, "COMPARE_ARTIFACT_NOT_FOUND");
  }

  const total = record.changes;
  return {
    comparisonId,
    changes,
    ...(remaining > 0
      ? { nextCursor: encodeCursor(offset + changes.length, fingerprint) }
      : {}),
    remaining,
    total,
    returned: changes.length,
  };
}

function normalizeFilters(
  filters: DocumentDiffReadInput["filters"],
): NormalizedFilters {
  if (filters === undefined) return {};
  const kinds =
    filters.kinds === undefined
      ? undefined
      : new Set(
          filters.kinds.filter((kind): kind is ChangeKind =>
            CHANGE_KINDS.includes(kind),
          ),
        );
  const signals =
    filters.signals === undefined ? undefined : expandSignals(filters.signals);
  const section =
    filters.section === undefined || filters.section.trim() === ""
      ? undefined
      : filters.section.trim().toLowerCase();
  return {
    ...(kinds === undefined || kinds.size === 0 ? {} : { kinds }),
    ...(signals === undefined || signals.size === 0 ? {} : { signals }),
    ...(section === undefined ? {} : { section }),
  };
}

/**
 * A filter value may be a signal code or a family name (§7 uses `money`,
 * `deadline`, `obligation`). Both spellings select the same changes; anything
 * else is refused, because a filter that quietly matched nothing would read
 * like "there are no such changes".
 */
function expandSignals(values: readonly string[]): Set<ChangeSignal> {
  const selected = new Set<ChangeSignal>();
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") continue;
    const known = CHANGE_SIGNALS.find(
      (signal) => signal === value.toUpperCase(),
    );
    if (known !== undefined) {
      selected.add(known);
      continue;
    }
    const family = SIGNAL_ALIASES[value.toLowerCase()];
    if (family === undefined) {
      throw new DocumentError(
        "INVALID_INPUT",
        `unknown signal filter "${value}"; use a signal code or one of: ${Object.keys(SIGNAL_ALIASES).sort().join(", ")}`,
      );
    }
    for (const signal of family) selected.add(signal);
  }
  return selected;
}

function matches(change: DocumentChange, filters: NormalizedFilters): boolean {
  if (filters.kinds !== undefined && !filters.kinds.has(change.kind)) {
    return false;
  }
  if (filters.signals !== undefined) {
    if (!change.signals.some((signal) => filters.signals?.has(signal))) {
      return false;
    }
  }
  if (filters.section !== undefined) {
    const location = change.right ?? change.left;
    const heading = (location?.headingPath ?? []).join(" › ").toLowerCase();
    if (!heading.includes(filters.section)) return false;
  }
  return true;
}

function fingerprintOf(filters: NormalizedFilters): string {
  return sha256Hex(
    JSON.stringify({
      kinds: filters.kinds === undefined ? [] : [...filters.kinds].sort(),
      signals: filters.signals === undefined ? [] : [...filters.signals].sort(),
      section: filters.section ?? "",
    }),
  ).slice(0, 16);
}

/**
 * A cursor names a place in one filtered stream. Paging with a different
 * filter is a caller mistake, not a silent re-read: the fingerprint makes it
 * an error the caller can see.
 */
function decodeCursor(cursor: string | undefined, fingerprint: string): number {
  if (cursor === undefined || cursor === "") return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new DocumentError(
      "INVALID_INPUT",
      "the cursor is not a cursor this tool issued",
    );
  }
  const shape = parsed as { offset?: unknown; fingerprint?: unknown };
  if (
    typeof shape.offset !== "number" ||
    !Number.isInteger(shape.offset) ||
    shape.offset < 0 ||
    typeof shape.fingerprint !== "string"
  ) {
    throw new DocumentError(
      "INVALID_INPUT",
      "the cursor is not a cursor this tool issued",
    );
  }
  if (shape.fingerprint !== fingerprint) {
    throw new DocumentError(
      "INVALID_INPUT",
      "the cursor belongs to a different set of filters",
    );
  }
  return shape.offset;
}

function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ offset, fingerprint }), "utf8").toString(
    "base64url",
  );
}

/** Parse one `changes.jsonl` line back into the change it describes. */
export function parseChange(line: string): DocumentChange {
  const raw = JSON.parse(line) as Record<string, unknown>;
  return raw as unknown as DocumentChange;
}
