import {
  defineDomain,
  domainTable,
  type Domain,
  type KvTable,
} from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import type { DomainDefinition, MemoryRecord } from "../types.js";
import { domainRecordSchema, memoryRecordSchema } from "./schema.js";

/**
 * Storage unit name. The grammar is `^[a-z][a-z0-9_]*$`, so the unit uses an
 * underscore while the runtime id and settings namespace use dashes.
 */
export const DOMAIN_EXPERTS_UNIT = "domain_experts";

/** Table holding one record per user-defined domain, keyed by domain id. */
export const DOMAINS_TABLE = "domains";

/** Table holding built-in memory records, keyed by `namespace::key`. */
export const MEMORY_TABLE = "memory";

/**
 * Durable domain storage.
 *
 * Unit v2 stores the complete catalog in the global slot. A v1 unit has no
 * global yet, so its domains table remains readable until the first catalog
 * write. The memory table and individual record schemas keep their format.
 * `invalidRecords` is deliberately
 * left at its strict default: a record that fails its schema aborts domain
 * storage initialization with a loud `DomainError` naming the table and key,
 * and the plugin then serves no domains and reports `STORAGE_UNAVAILABLE`.
 * Skipping the record would silently drop a user's domain.
 */
export const domainExpertsSpec = defineDomain({
  name: DOMAIN_EXPERTS_UNIT,
  version: 2,
  compatibleVersions: [1],
  global: {
    schema: z.object({
      domains: z
        .array(domainRecordSchema)
        .nullable()
        .refine(
          (domains) =>
            domains === null ||
            new Set(domains.map(({ id }) => id)).size === domains.length,
          "Catalog snapshot contains duplicate domain IDs.",
        ),
    }),
    initial: { domains: null } as CatalogSnapshot,
  },
  tables: {
    [DOMAINS_TABLE]: domainTable<string, DomainDefinition>(domainRecordSchema),
    [MEMORY_TABLE]: domainTable<string, MemoryRecord>(memoryRecordSchema),
  },
});

export interface CatalogSnapshot {
  readonly domains: readonly DomainDefinition[] | null;
}

export interface CatalogStore {
  read(): ReadonlyMap<string, DomainDefinition>;
  write(domains: ReadonlyMap<string, DomainDefinition>): Promise<void>;
}

export type DomainTable = KvTable<string, DomainDefinition>;
export type MemoryRecordTable = KvTable<string, MemoryRecord>;
export type DomainExpertsStorage = Domain<typeof domainExpertsSpec>;

export function catalogStoreOf(storage: DomainExpertsStorage): CatalogStore {
  let cached: CatalogSnapshot | undefined;
  let domains: ReadonlyMap<string, DomainDefinition> = new Map();
  return {
    read() {
      const snapshot = storage.global.get();
      if (cached !== snapshot) {
        domains =
          snapshot.domains === null
            ? new Map(storage.table(DOMAINS_TABLE).entries())
            : new Map(snapshot.domains.map((domain) => [domain.id, domain]));
        cached = snapshot;
      }
      return domains;
    },
    write(next) {
      return storage.global.set({ domains: [...next.values()] });
    },
  };
}

export function memoryTableOf(
  storage: DomainExpertsStorage,
): MemoryRecordTable {
  return storage.table(MEMORY_TABLE);
}
