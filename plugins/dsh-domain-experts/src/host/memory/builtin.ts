import type { MemoryRecord } from "../../types.js";
import { normalizeNamespace } from "../schema.js";
import type { DomainMemoryProvider, MemoryQuery } from "./registry.js";

export const BUILTIN_MEMORY_PROVIDER_ID = "builtin";

/** Minimal key/value surface the built-in provider needs from storage. */
export interface MemoryTable {
  get(key: string): MemoryRecord | undefined;
  entries(): IterableIterator<[string, MemoryRecord]>;
  put(key: string, value: MemoryRecord): Promise<void>;
  delete(key: string): Promise<boolean>;
}

const SEPARATOR = "::";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MAX_TEXT_LENGTH = 8_000;

export function memoryKeyOf(namespace: string, key: string): string {
  return `${namespace}${SEPARATOR}${key}`;
}

/**
 * Durable memory on the plugin's own storage domain.
 *
 * Namespaces are a storage-level partition, not a hint: every read and write
 * goes through {@link memoryKeyOf}, so a caller cannot address another
 * domain's records by passing a crafted key.
 */
export function createBuiltinMemoryProvider(
  table: MemoryTable,
  now: () => number = Date.now,
): DomainMemoryProvider {
  const recordsIn = (namespace: string): readonly MemoryRecord[] => {
    const prefix = `${namespace}${SEPARATOR}`;
    const out: MemoryRecord[] = [];
    for (const [key, record] of table.entries()) {
      if (key.startsWith(prefix)) out.push(record);
    }
    return out.sort((left, right) => right.updatedAt - left.updatedAt);
  };

  return {
    id: BUILTIN_MEMORY_PROVIDER_ID,
    title: "Built-in storage",
    builtin: true,

    listNamespaces(): readonly string[] {
      const namespaces = new Set<string>();
      for (const record of table.entries()) {
        // The record carries its own namespace, so the key layout is not
        // re-parsed here.
        namespaces.add(record[1].namespace);
      }
      return [...namespaces].sort((left, right) =>
        left.localeCompare(right, "en"),
      );
    },

    async retrieve(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
      const terms = tokenize(query.query);
      const limit = clampLimit(query.limit);
      const scored: { record: MemoryRecord; hits: number }[] = [];
      for (const namespace of query.namespaces) {
        for (const record of recordsIn(namespace)) {
          const hits = terms.length === 0 ? 0 : countHits(record, terms);
          if (terms.length > 0 && hits === 0) continue;
          scored.push({ record, hits });
        }
      }
      scored.sort((left, right) => {
        if (right.hits !== left.hits) return right.hits - left.hits;
        return right.record.updatedAt - left.record.updatedAt;
      });
      return scored.slice(0, limit).map((entry) => entry.record);
    },

    async inspect(namespace: string): Promise<readonly MemoryRecord[]> {
      return recordsIn(normalizeNamespace(namespace));
    },

    async remember(
      namespace: string,
      key: string,
      text: string,
      tags: readonly string[] = [],
    ): Promise<MemoryRecord> {
      const trimmedKey = key.trim();
      if (trimmedKey === "") {
        throw new Error("A memory record needs a non-empty key.");
      }
      const trimmedText = text.trim();
      if (trimmedText === "") {
        throw new Error("A memory record needs non-empty text.");
      }
      const normalizedNamespace = normalizeNamespace(namespace);
      const storageKey = memoryKeyOf(normalizedNamespace, trimmedKey);
      const existing = table.get(storageKey);
      const timestamp = now();
      const record: MemoryRecord = {
        namespace: normalizedNamespace,
        key: trimmedKey,
        text:
          trimmedText.length > MAX_TEXT_LENGTH
            ? `${trimmedText.slice(0, MAX_TEXT_LENGTH)}…`
            : trimmedText,
        tags: [
          ...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== "")),
        ],
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await table.put(storageKey, record);
      return record;
    },

    async forget(namespace: string, key: string): Promise<boolean> {
      return table.delete(
        memoryKeyOf(normalizeNamespace(namespace), key.trim()),
      );
    },

    async clear(namespace: string): Promise<number> {
      const target = normalizeNamespace(namespace);
      const doomed = recordsIn(target).map((record) =>
        memoryKeyOf(target, record.key),
      );
      let removed = 0;
      for (const key of doomed) {
        if (await table.delete(key)) removed += 1;
      }
      return removed;
    },
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(limit), MAX_LIMIT);
}

function tokenize(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 1);
}

function countHits(record: MemoryRecord, terms: readonly string[]): number {
  const haystack =
    `${record.key}\n${record.text}\n${record.tags.join(" ")}`.toLowerCase();
  let hits = 0;
  for (const term of terms) if (haystack.includes(term)) hits += 1;
  return hits;
}
