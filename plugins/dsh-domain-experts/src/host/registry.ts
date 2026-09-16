import type { DomainDefinition } from "../types.js";
import { DomainExpertsError } from "./errors.js";
import {
  assertValidDomain,
  normalizeDomainDefinition,
  parseDomainDefinition,
  summarizeDomain,
  validateDomainDefinition,
  type ValidationIssue,
} from "./schema.js";
import type { DomainTable } from "./storage.js";
import type { DomainSummary } from "../types.js";

/**
 * CRUD over the durable domain table.
 *
 * The registry owns identity rules: an id is assigned on create and never
 * changes, `createdAt` survives updates, and `updatedAt` is stamped from the
 * injected clock so tests are deterministic. Reads are synchronous — the
 * storage layer keeps authoritative state in memory and every write awaits
 * durability before it mutates that state.
 */
export class DomainRegistry {
  private readonly table: DomainTable;
  private readonly now: () => number;

  constructor(table: DomainTable, now: () => number = Date.now) {
    this.table = table;
    this.now = now;
  }

  /** Every domain, ordered by display name then id. */
  list(): readonly DomainDefinition[] {
    const out: DomainDefinition[] = [];
    for (const [, record] of this.table.entries()) out.push(record);
    return out.sort(compareDomains);
  }

  get(id: string): DomainDefinition | undefined {
    return this.table.get(id);
  }

  has(id: string): boolean {
    return this.table.get(id) !== undefined;
  }

  summaries(
    decorate?: (definition: DomainDefinition) => number,
  ): readonly DomainSummary[] {
    return this.list().map((definition) =>
      summarizeDomain(definition, decorate?.(definition) ?? 0),
    );
  }

  /** Validate a draft without persisting it; used by the editor's live check. */
  inspectDraft(input: unknown): {
    readonly definition: DomainDefinition | null;
    readonly issues: readonly ValidationIssue[];
    readonly message: string;
  } {
    let definition: DomainDefinition;
    try {
      definition = parseDomainDefinition(input, this.now());
    } catch (error) {
      return {
        definition: null,
        issues: [],
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const issues = validateDomainDefinition(definition);
    return { definition, issues, message: "" };
  }

  async create(input: unknown): Promise<DomainDefinition> {
    const parsed = parseDomainDefinition(input, this.now());
    assertValidDomain(parsed);
    if (this.has(parsed.id)) {
      throw new DomainExpertsError(
        "DOMAIN_EXISTS",
        `Domain "${parsed.id}" already exists.`,
        {
          refs: [parsed.id],
        },
      );
    }
    const now = this.now();
    const record = normalizeDomainDefinition({
      ...parsed,
      createdAt: now,
      updatedAt: now,
    });
    await this.table.put(record.id, record);
    return record;
  }

  /**
   * Replace a domain's definition. The id identifies the record and is not
   * itself editable — a rename would invalidate every delegation target and
   * memory namespace that references it.
   */
  async update(input: unknown): Promise<DomainDefinition> {
    const parsed = parseDomainDefinition(input, this.now());
    const existing = this.table.get(parsed.id);
    if (existing === undefined) {
      throw new DomainExpertsError(
        "DOMAIN_NOT_FOUND",
        `Domain "${parsed.id}" does not exist.`,
        { refs: [parsed.id] },
      );
    }
    assertValidDomain(parsed);
    const record = normalizeDomainDefinition({
      ...parsed,
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    });
    await this.table.put(record.id, record);
    return record;
  }

  async setEnabled(id: string, enabled: boolean): Promise<DomainDefinition> {
    const existing = this.require(id);
    if (existing.enabled === enabled) return existing;
    const record = normalizeDomainDefinition({
      ...existing,
      enabled,
      updatedAt: this.now(),
    });
    await this.table.put(record.id, record);
    return record;
  }

  async remove(id: string): Promise<boolean> {
    return this.table.delete(id);
  }

  require(id: string): DomainDefinition {
    const record = this.table.get(id);
    if (record === undefined) {
      throw new DomainExpertsError(
        "DOMAIN_NOT_FOUND",
        `Domain "${id}" does not exist. Known domains: ${this.knownIds().join(", ") || "(none)"}.`,
        { refs: [id] },
      );
    }
    return record;
  }

  /** An enabled domain, or the code that says why it cannot be used. */
  requireEnabled(id: string): DomainDefinition {
    const record = this.require(id);
    if (!record.enabled) {
      throw new DomainExpertsError(
        "DOMAIN_DISABLED",
        `Domain "${id}" is disabled.`,
        {
          refs: [id],
        },
      );
    }
    return record;
  }

  knownIds(): readonly string[] {
    return [...this.table.keys()].sort();
  }
}

function compareDomains(
  left: DomainDefinition,
  right: DomainDefinition,
): number {
  const byName = left.name.localeCompare(right.name, "en");
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id, "en");
}
