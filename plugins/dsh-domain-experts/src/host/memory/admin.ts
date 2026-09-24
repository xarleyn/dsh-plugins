import type {
  DomainDefinition,
  MemoryPageView,
  MemoryRecord,
  MemoryScopeView,
} from "../../types.js";
import { DomainExpertsError } from "../errors.js";
import type { LogSink } from "../execution.js";
import { memoryEntries } from "../resolver.js";
import { normalizeNamespace } from "../schema.js";
import { clampLimit, countHits, searchTextOf, tokenize } from "./shared.js";
import type { DomainMemoryProvider } from "./registry.js";

/**
 * Memory maintenance for a human reader (design §15).
 *
 * The agent-facing surface is the `domain_memory` tool, and it is deliberately
 * blind: a running expert sees only its own namespaces and can only append. An
 * operator does the opposite — moves across every expert, reads what was
 * recorded, and corrects or deletes a line that turned out to be wrong. That is
 * a second contract on the same store, so it is a second module, and both go
 * through the provider rather than around it: whichever backend a deployment
 * configured is the one that answers, and a maintenance path that read the
 * storage unit directly would be silently editing a database nobody recalls
 * from.
 *
 * These methods throw the plugin's typed refusals instead of wrapping them into
 * a result envelope, because the caller is another plugin's service on the host
 * plane, which maps them onto its own wire format. The browser never reaches
 * here directly, and nothing in this module is a `@Remote` on purpose: an
 * unauthenticated write endpoint over a store that feeds every expert's prompt
 * is the exact shape of a hole this repository has already been burned by.
 */

/** How many keys one bulk delete may name; a page of records, comfortably. */
export const MAX_BULK_KEYS = 500;

export interface MemoryAdminDependencies {
  /** The enabled domains, with storage opened by the caller. */
  definitions(): Promise<readonly DomainDefinition[]>;
  /** The provider the deployment configured, resolved on every call. */
  provider(): DomainMemoryProvider;
  logger: LogSink;
}

/** What one operator's edit replaces; the key never moves. */
export interface MemoryCorrection {
  readonly namespace: string;
  readonly key: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface MemoryAdmin {
  /** Every namespace the enabled experts declare, with its record count. */
  scopes(): Promise<readonly MemoryScopeView[]>;
  /**
   * One namespace's records, newest first.
   *
   * `query` keeps a record only when every one of its terms appears in it — the
   * stricter reading an operator filtering a list expects, on the same
   * definition of "appears in" the recall scorer uses.
   */
  search(
    namespace: string,
    query: string,
    limit: number,
    offset: number,
  ): Promise<MemoryPageView>;
  /** Rewrite the record one key holds; refuses when it no longer exists. */
  correct(input: MemoryCorrection): Promise<MemoryRecord>;
  /** Drop one record, answering whether it was there to drop. */
  remove(namespace: string, key: string): Promise<boolean>;
  /** Drop the named records of one namespace; returns how many went. */
  removeMany(namespace: string, keys: readonly string[]): Promise<number>;
  /** Drop everything one namespace holds; returns how many went. */
  wipe(namespace: string): Promise<number>;
}

/** An operator's note is kept as written; only emptiness is refused. */
function requireField(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new DomainExpertsError(
      "TASK_REJECTED",
      `A memory correction needs a non-empty ${label}.`,
    );
  }
  return trimmed;
}

export function createMemoryAdmin(
  dependencies: MemoryAdminDependencies,
): MemoryAdmin {
  /**
   * The namespaces the enabled experts point at, as maintenance sees them.
   *
   * One record count per namespace however many experts share it: a shared
   * read-only carrier belongs to another domain's storage partition, and two
   * counts of one namespace would invite an operator to reconcile a number that
   * is already one number.
   */
  async function scopes(): Promise<readonly MemoryScopeView[]> {
    const definitions = await dependencies.definitions();
    const provider = dependencies.provider();
    const counts = new Map<string, number>();
    const views: MemoryScopeView[] = [];
    for (const definition of definitions) {
      if (!definition.enabled) continue;
      for (const entry of memoryEntries(definition)) {
        let records = counts.get(entry.namespace);
        if (records === undefined) {
          records = (await provider.inspect(entry.namespace)).length;
          counts.set(entry.namespace, records);
        }
        views.push({
          domainId: definition.id,
          domainName: definition.name,
          namespace: entry.namespace,
          access: entry.access,
          records,
        });
      }
    }
    return views.sort((left, right) => {
      if (left.namespace !== right.namespace) {
        return left.namespace.localeCompare(right.namespace, "en");
      }
      return left.domainId.localeCompare(right.domainId, "en");
    });
  }

  /** The one view a caller names, refusing anything outside the experts. */
  async function scopeOf(
    namespace: string,
    writable: boolean,
  ): Promise<MemoryScopeView> {
    const target = normalizeNamespace(namespace);
    const views = await scopes();
    const found = views.find(
      (view) =>
        view.namespace === target &&
        (!writable || view.access === "read-write"),
    );
    if (found === undefined) {
      throw new DomainExpertsError(
        "MEMORY_SCOPE_DENIED",
        writable
          ? `Namespace "${target}" is not the private namespace of an enabled expert, so maintenance cannot write it.`
          : `Namespace "${target}" is not declared by any enabled expert.`,
        { refs: [target] },
      );
    }
    return found;
  }

  return {
    scopes,

    async search(
      namespace: string,
      query: string,
      limit: number,
      offset: number,
    ): Promise<MemoryPageView> {
      const scope = await scopeOf(namespace, false);
      const all = await dependencies.provider().inspect(scope.namespace);
      const terms = tokenize(query);
      const matched =
        terms.length === 0
          ? all
          : all.filter(
              (record) =>
                countHits(searchTextOf(record), terms) === terms.length,
            );
      const from = Number.isFinite(offset)
        ? Math.max(0, Math.trunc(offset))
        : 0;
      return {
        records: matched.slice(from, from + clampLimit(limit)),
        total: matched.length,
      };
    },

    async correct(input: MemoryCorrection): Promise<MemoryRecord> {
      const scope = await scopeOf(input.namespace, true);
      const key = requireField(input.key, "record key");
      const text = requireField(input.text, "text");
      const record = await dependencies
        .provider()
        .replace(scope.namespace, key, text, input.tags ?? []);
      if (record === undefined) {
        throw new DomainExpertsError(
          "MEMORY_RECORD_MISSING",
          `No record ${scope.namespace}/${key} is stored anymore; reload the list before editing it again.`,
          { refs: [scope.namespace, key] },
        );
      }
      dependencies.logger.info("domain-experts/memory-corrected", {
        namespace: record.namespace,
        key: record.key,
        tags: record.tags.length,
      });
      return record;
    },

    async remove(namespace: string, key: string): Promise<boolean> {
      const scope = await scopeOf(namespace, true);
      const removed = await dependencies
        .provider()
        .forget(scope.namespace, requireField(key, "record key"));
      dependencies.logger.info("domain-experts/memory-record-removed", {
        namespace: scope.namespace,
        key,
        removed,
      });
      return removed;
    },

    async removeMany(
      namespace: string,
      keys: readonly string[],
    ): Promise<number> {
      const scope = await scopeOf(namespace, true);
      const wanted = [
        ...new Set(keys.map((key) => key.trim()).filter((key) => key !== "")),
      ];
      if (wanted.length === 0) {
        throw new DomainExpertsError(
          "TASK_REJECTED",
          "A bulk memory delete needs at least one record key.",
        );
      }
      if (wanted.length > MAX_BULK_KEYS) {
        throw new DomainExpertsError(
          "TASK_REJECTED",
          `A bulk memory delete names ${String(wanted.length)} records; the cap is ${String(MAX_BULK_KEYS)}.`,
        );
      }
      const provider = dependencies.provider();
      let removed = 0;
      for (const key of wanted) {
        if (await provider.forget(scope.namespace, key)) removed += 1;
      }
      dependencies.logger.info("domain-experts/memory-records-removed", {
        namespace: scope.namespace,
        named: wanted.length,
        removed,
      });
      return removed;
    },

    async wipe(namespace: string): Promise<number> {
      const scope = await scopeOf(namespace, true);
      const cleared = await dependencies.provider().clear(scope.namespace);
      dependencies.logger.info("domain-experts/memory-wiped", {
        namespace: scope.namespace,
        cleared,
      });
      return cleared;
    },
  };
}
