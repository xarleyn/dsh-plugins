import type {
  QaExpertMemoryAdmin,
  QaExpertMemoryRecordInput,
} from "../../src/integration/expert-memory.js";
import type {
  QaExpertMemoryRecord,
  QaExpertMemoryScope,
} from "../../src/types.js";

/**
 * A stand-in for the domain-experts memory seam.
 *
 * The plugin's own policy — which namespace a caller may write, what counts as
 * a match, when a correction refuses — is tested where it lives, in
 * `dsh-domain-experts/tests/memory-admin.test.ts`. What the console owes its
 * own tests is the part it adds: who may call, what lands in the audit trail,
 * and which refusal word reaches the browser. So this double answers like the
 * real one and remembers what it was asked.
 */

/** A refusal shaped the way the sibling plugin throws one: a stable `code`. */
export function memoryRefusal(code: string): Error {
  return Object.assign(new Error(`the memory seam refused (${code})`), {
    code,
  });
}

export interface FakeExpertMemory extends QaExpertMemoryAdmin {
  readonly calls: readonly {
    readonly method: string;
    readonly args: readonly unknown[];
  }[];
  recordsOf(namespace: string): readonly QaExpertMemoryRecord[];
}

export function fakeExpertMemory(
  options: {
    readonly scopes?: readonly QaExpertMemoryScope[];
    readonly records?: readonly QaExpertMemoryRecord[];
    /** Throw instead of answering, to play a refusal the seam would raise. */
    readonly refuse?: Partial<Record<keyof QaExpertMemoryAdmin, () => never>>;
  } = {},
): FakeExpertMemory {
  const stored = new Map<string, QaExpertMemoryRecord>(
    (options.records ?? []).map((record) => [
      `${record.namespace}::${record.key}`,
      record,
    ]),
  );
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const writableNamespaces = new Set(
    (options.scopes ?? [])
      .filter((scope) => scope.access === "read-write")
      .map((scope) => scope.namespace),
  );

  const guard = <T>(
    method: keyof QaExpertMemoryAdmin,
    args: readonly unknown[],
    run: () => T,
  ): T => {
    calls.push({ method, args });
    const refusal = options.refuse?.[method];
    if (refusal !== undefined) return refusal();
    return run();
  };

  const of = (namespace: string): QaExpertMemoryRecord[] =>
    [...stored.values()]
      .filter((record) => record.namespace === namespace)
      .sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    calls,
    recordsOf: of,

    async scopes() {
      return guard("scopes", [], () =>
        (options.scopes ?? []).map((scope) => ({
          ...scope,
          records: of(scope.namespace).length,
        })),
      );
    },

    async search(namespace, query, limit, offset) {
      return guard("search", [namespace, query, limit, offset], () => {
        const needle = query.trim().toLowerCase();
        const matched = of(namespace).filter(
          (record) =>
            needle === "" ||
            `${record.key}\n${record.text}\n${record.tags.join(" ")}`
              .toLowerCase()
              .includes(needle),
        );
        return {
          records: matched.slice(offset, offset + limit),
          total: matched.length,
        };
      });
    },

    async correct(input: QaExpertMemoryRecordInput) {
      return guard("correct", [input], () => {
        const id = `${input.namespace}::${input.key}`;
        const existing = stored.get(id);
        if (existing === undefined)
          throw memoryRefusal("MEMORY_RECORD_MISSING");
        if (!writableNamespaces.has(input.namespace)) {
          throw memoryRefusal("MEMORY_SCOPE_DENIED");
        }
        const record: QaExpertMemoryRecord = {
          ...existing,
          text: input.text,
          tags: [...(input.tags ?? [])],
          updatedAt: existing.updatedAt + 1_000,
        };
        stored.set(id, record);
        return record;
      });
    },

    async remove(namespace, key) {
      return guard("remove", [namespace, key], () => {
        if (!writableNamespaces.has(namespace)) {
          throw memoryRefusal("MEMORY_SCOPE_DENIED");
        }
        return stored.delete(`${namespace}::${key}`);
      });
    },

    async removeMany(namespace, keys) {
      return guard("removeMany", [namespace, keys], () => {
        if (!writableNamespaces.has(namespace)) {
          throw memoryRefusal("MEMORY_SCOPE_DENIED");
        }
        let removed = 0;
        for (const key of keys) {
          if (stored.delete(`${namespace}::${key}`)) removed += 1;
        }
        return removed;
      });
    },

    async wipe(namespace) {
      return guard("wipe", [namespace], () => {
        if (!writableNamespaces.has(namespace)) {
          throw memoryRefusal("MEMORY_SCOPE_DENIED");
        }
        const doomed = of(namespace);
        for (const record of doomed) {
          stored.delete(`${record.namespace}::${record.key}`);
        }
        return doomed.length;
      });
    },
  };
}
