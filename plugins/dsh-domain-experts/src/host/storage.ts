import {
  defineDomain,
  domainTable,
  type Domain,
  type KvTable,
} from "@deepseek-ai/dsh-storage-domain";
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
 * `version` is the unit-level format version and moves together with
 * `DOMAIN_RECORD_VERSION`: a breaking record change bumps both and lists the
 * previous version in `compatibleVersions`. `invalidRecords` is deliberately
 * left at its strict default: a record that fails its schema aborts domain
 * storage initialization with a loud `DomainError` naming the table and key,
 * and the plugin then serves no domains and reports `STORAGE_UNAVAILABLE`.
 * Skipping the record would silently drop a user's domain.
 */
export const domainExpertsSpec = defineDomain({
  name: DOMAIN_EXPERTS_UNIT,
  version: 1,
  tables: {
    [DOMAINS_TABLE]: domainTable<string, DomainDefinition>(domainRecordSchema),
    [MEMORY_TABLE]: domainTable<string, MemoryRecord>(memoryRecordSchema),
  },
});

export type DomainTable = KvTable<string, DomainDefinition>;
export type MemoryRecordTable = KvTable<string, MemoryRecord>;
export type DomainExpertsStorage = Domain<typeof domainExpertsSpec>;

export function domainsTableOf(storage: DomainExpertsStorage): DomainTable {
  return storage.table(DOMAINS_TABLE);
}

export function memoryTableOf(
  storage: DomainExpertsStorage,
): MemoryRecordTable {
  return storage.table(MEMORY_TABLE);
}
