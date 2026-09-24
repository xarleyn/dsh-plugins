import type { MemoryRecord } from "../../types.js";
import { normalizeNamespace } from "../schema.js";
import {
  SEPARATOR,
  buildMemoryRecord,
  clampLimit,
  compareRecords,
  compareScored,
  countHits,
  memoryKeyOf,
  searchTextOf,
  tokenize,
  type MemoryTable,
} from "./shared.js";
import type { DomainMemoryProvider, MemoryQuery } from "./registry.js";

export const BUILTIN_MEMORY_PROVIDER_ID = "builtin";

export type { MemoryTable } from "./shared.js";
export { memoryKeyOf } from "./shared.js";

/**
 * Durable memory on the plugin's own storage domain.
 *
 * Namespaces are a storage-level partition, not a hint: every read and write
 * goes through {@link memoryKeyOf}, so a caller cannot address another
 * domain's records by passing a crafted key.
 *
 * What counts as a match, in which order matches come back and what a written
 * record looks like live in `./shared.js`, because the SQLite-backed provider
 * has to answer identically — a change of backend must not change what an
 * expert recalls.
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
    return out.sort(compareRecords);
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
          const hits =
            terms.length === 0 ? 0 : countHits(searchTextOf(record), terms);
          if (terms.length > 0 && hits === 0) continue;
          scored.push({ record, hits });
        }
      }
      scored.sort(compareScored);
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
      const normalizedNamespace = normalizeNamespace(namespace);
      const storageKey = memoryKeyOf(normalizedNamespace, key.trim());
      const record = buildMemoryRecord(
        { namespace: normalizedNamespace, key, text, tags },
        table.get(storageKey),
        now(),
      );
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
