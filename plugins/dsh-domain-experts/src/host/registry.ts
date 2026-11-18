import { randomBytes } from "node:crypto";
import type {
  CatalogImportMode,
  CatalogPreview,
  DomainDefinition,
} from "../types.js";
import {
  exportCatalog,
  prepareCatalogWrite,
  previewCatalog,
} from "./catalog-transfer.js";
import { DomainExpertsError } from "./errors.js";
import {
  assertValidDomain,
  normalizeDomainDefinition,
  parseDomainDefinition,
  summarizeDomain,
  validateDomainDefinition,
  type ValidationIssue,
} from "./schema.js";
import type { CatalogStore } from "./storage.js";
import type { DomainSummary } from "../types.js";

/**
 * CRUD and imports over the durable catalog.
 *
 * The registry owns identity rules: an id is assigned on create and never
 * changes, `createdAt` survives updates, and `updatedAt` is stamped from the
 * injected clock so tests are deterministic. Reads are synchronous — the
 * storage layer keeps the last committed snapshot in memory. A single queue
 * holds the read and commit together across both CRUD and bulk imports.
 */
export class DomainRegistry {
  private readonly store: CatalogStore;
  private readonly now: () => number;
  private readonly previewKey = randomBytes(32);
  private writes: Promise<unknown> = Promise.resolve();

  constructor(store: CatalogStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  private enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = this.writes.then(write);
    this.writes = result.catch(() => undefined);
    return result;
  }

  /** Every domain, ordered by display name then id. */
  list(): readonly DomainDefinition[] {
    return [...this.store.read().values()].sort(compareDomains);
  }

  get(id: string): DomainDefinition | undefined {
    return this.store.read().get(id);
  }

  has(id: string): boolean {
    return this.store.read().has(id);
  }

  exportCatalog(): string {
    return exportCatalog(this.store.read());
  }

  previewImport(document: string, mode: CatalogImportMode): CatalogPreview {
    return previewCatalog(this.previewKey, this.store.read(), document, mode);
  }

  applyImport(
    document: string,
    mode: CatalogImportMode,
    token: string,
  ): Promise<number> {
    return this.enqueue(async () => {
      const { next, changed } = prepareCatalogWrite(
        this.previewKey,
        this.store.read(),
        document,
        mode,
        token,
        this.now(),
      );
      if (changed !== 0) await this.store.write(next);
      return changed;
    });
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
    return this.enqueue(async () => {
      if (this.has(parsed.id)) {
        throw new DomainExpertsError(
          "DOMAIN_EXISTS",
          `Domain "${parsed.id}" already exists.`,
          { refs: [parsed.id] },
        );
      }
      const now = this.now();
      return this.put({ ...parsed, createdAt: now, updatedAt: now });
    });
  }

  /**
   * Replace a domain's definition. The id identifies the record and is not
   * itself editable — a rename would invalidate every delegation target and
   * memory namespace that references it.
   */
  async update(input: unknown): Promise<DomainDefinition> {
    const parsed = parseDomainDefinition(input, this.now());
    return this.enqueue(async () => {
      const existing = this.get(parsed.id);
      if (existing === undefined) {
        throw new DomainExpertsError(
          "DOMAIN_NOT_FOUND",
          `Domain "${parsed.id}" does not exist.`,
          { refs: [parsed.id] },
        );
      }
      assertValidDomain(parsed);
      return this.put({
        ...parsed,
        createdAt: existing.createdAt,
        updatedAt: this.now(),
      });
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<DomainDefinition> {
    return this.enqueue(async () => {
      const existing = this.require(id);
      if (existing.enabled === enabled) return existing;
      return this.put({ ...existing, enabled, updatedAt: this.now() });
    });
  }

  remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const next = new Map(this.store.read());
      if (!next.delete(id)) return false;
      await this.store.write(next);
      return true;
    });
  }

  private async put(input: DomainDefinition): Promise<DomainDefinition> {
    const record = normalizeDomainDefinition(input);
    const next = new Map(this.store.read());
    next.set(record.id, record);
    await this.store.write(next);
    return record;
  }

  require(id: string): DomainDefinition {
    const record = this.get(id);
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
    return [...this.store.read().keys()].sort();
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
