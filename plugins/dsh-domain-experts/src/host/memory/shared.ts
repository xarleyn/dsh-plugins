import type { MemoryRecord } from "../../types.js";
import { normalizeNamespace } from "../schema.js";

/**
 * The parts every memory backend must agree on.
 *
 * A deployment switches where memory lives without changing what it answers,
 * and the only way to keep that promise is for the backends to share the code
 * that decides it: the key layout, what counts as a match, and in which order
 * two records come back. Duplicating these in a second provider is how a
 * migration quietly changes an expert's recall.
 */

/** Separator of the storage key `<namespace>::<key>`. */
export const SEPARATOR = "::";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

/**
 * One record's text, as the current backends store it. Truncation happens on
 * write, so an imported record already carries its ellipsis and an import must
 * not re-truncate what it copies.
 */
export const MAX_TEXT_LENGTH = 8_000;

export function memoryKeyOf(namespace: string, key: string): string {
  return `${namespace}${SEPARATOR}${key}`;
}

/** Minimal key/value surface a storage-backed provider needs. */
export interface MemoryTable {
  get(key: string): MemoryRecord | undefined;
  entries(): IterableIterator<[string, MemoryRecord]>;
  put(key: string, value: MemoryRecord): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** The identity of a record: its namespace, trimmed key and stored fields. */
export interface MemoryRecordDraft {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly tags: readonly string[];
}

/** Blank tags, trimmed of the empties, in first-seen order. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [
    ...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== "")),
  ];
}

/**
 * Build the record a write stores.
 *
 * `createdAt` survives a rewrite because a memory's age is part of what a
 * reader judges; `updatedAt` is what ranking sorts by. The text is trimmed, and
 * an over-long text keeps the truncation marker the backend has always written.
 */
export function buildMemoryRecord(
  draft: MemoryRecordDraft,
  existing: MemoryRecord | undefined,
  timestamp: number,
): MemoryRecord {
  const trimmedKey = draft.key.trim();
  if (trimmedKey === "") {
    throw new Error("A memory record needs a non-empty key.");
  }
  const trimmedText = draft.text.trim();
  if (trimmedText === "") {
    throw new Error("A memory record needs non-empty text.");
  }
  const namespace = normalizeNamespace(draft.namespace);
  const text =
    trimmedText.length > MAX_TEXT_LENGTH
      ? `${trimmedText.slice(0, MAX_TEXT_LENGTH)}…`
      : trimmedText;
  const key = trimmedKey;
  const tags = normalizeTags(draft.tags);
  return {
    namespace,
    key,
    text,
    tags,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

/** Query terms: the words a record has to contain, in the caller's order. */
export function tokenize(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 1);
}

/**
 * The lowercased text one record is searched in: its key, its body and its
 * tags. A backend that keeps this in a column must store exactly this string,
 * because a search index built from anything else finds something else.
 */
export function searchTextOf(
  record: Pick<MemoryRecord, "key" | "text" | "tags">,
): string {
  return `${record.key}\n${record.text}\n${record.tags.join(" ")}`.toLowerCase();
}

/** How many of the terms appear in {@link searchTextOf} as substrings. */
export function countHits(
  searchText: string,
  terms: readonly string[],
): number {
  let hits = 0;
  for (const term of terms) if (searchText.includes(term)) hits += 1;
  return hits;
}

/** The limit actually honoured: a bad value falls back, a huge one is capped. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(limit), MAX_LIMIT);
}

/**
 * Newest first, then by identity.
 *
 * The tie-break is deliberate and it is not locale-aware: records written in
 * the same millisecond are common (one session records several findings), so an
 * order that depends on insertion history makes a migration look like it
 * changed the answer. Code-unit comparison is what SQLite's own `ORDER BY`
 * does, so both backends break the tie the same way.
 */
export function compareRecords(
  left: MemoryRecord,
  right: MemoryRecord,
): number {
  if (left.updatedAt !== right.updatedAt)
    return right.updatedAt - left.updatedAt;
  if (left.namespace !== right.namespace)
    return left.namespace < right.namespace ? -1 : 1;
  if (left.key !== right.key) return left.key < right.key ? -1 : 1;
  return 0;
}

/** Better match first; within one match score, {@link compareRecords}. */
export function compareScored(
  left: { readonly record: MemoryRecord; readonly hits: number },
  right: { readonly record: MemoryRecord; readonly hits: number },
): number {
  if (left.hits !== right.hits) return right.hits - left.hits;
  return compareRecords(left.record, right.record);
}
