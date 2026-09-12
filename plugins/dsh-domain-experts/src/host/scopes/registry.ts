import type {
  DomainDefinition,
  ResolvedProviderEntry,
  ResolvedResourceEntry,
  ScopeProviderInfo,
  ScopeEnforcement,
} from "../../types.js";
import { DomainExpertsError } from "../errors.js";

/** Provider ids are lowercase slugs; they key `scope.providers[id]`. */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

export interface ScopeProviderInput {
  readonly domain: DomainDefinition;
  /** JSON document from `scope.providers[id]`; `''` when unconfigured. */
  readonly config: string;
  /** Absolute session working directory; `''` when the caller has none. */
  readonly workspaceDir: string;
  readonly depth: number;
  readonly callerDomain: string | null;
  /**
   * Worker ids that declare they enforce this provider
   * (`DomainWorker.enforces`). Empty means nothing applies the restriction, so
   * the provider must report its entries as advisory.
   */
  readonly enforcedBy: readonly string[];
}

export interface ScopeProviderOutput {
  readonly resources: readonly ResolvedResourceEntry[];
  /** JSON-encoded external scope for `DomainScope.external[id]`; `''` for none. */
  readonly external: string;
}

/**
 * A pluggable source of domain scope (design §12).
 *
 * The core understands neither Jira nor Confluence: a third-party package
 * registers its own provider and contributes resources plus an opaque external
 * scope document. Providers are the only place that knows a concrete product.
 */
export interface DomainScopeProvider {
  readonly id: string;
  readonly title: string;
  /**
   * How honest the enforcement claim is when a worker does apply this
   * provider's restrictions. A provider that nothing can enforce stays
   * `advisory`.
   */
  readonly enforcement: ScopeEnforcement;
  /** True only for providers shipped with this plugin. */
  readonly builtin: boolean;
  /** Reject a malformed config document; must throw, never repair silently. */
  validate(config: string): void;
  /** One-line human summary for the resources editor. */
  describe(config: string): string;
  apply(input: ScopeProviderInput): Promise<ScopeProviderOutput>;
}

/** Registry of scope providers; the extension seam for other packages. */
export class ScopeProviderRegistry {
  private readonly providers = new Map<string, DomainScopeProvider>();

  register(provider: DomainScopeProvider): () => void {
    if (!PROVIDER_ID_PATTERN.test(provider.id)) {
      throw new DomainExpertsError(
        "DOMAIN_INVALID",
        `Scope provider id "${provider.id}" must match ${String(PROVIDER_ID_PATTERN)}.`,
      );
    }
    if (this.providers.has(provider.id)) {
      throw new DomainExpertsError(
        "DOMAIN_INVALID",
        `Scope provider "${provider.id}" is already registered.`,
      );
    }
    this.providers.set(provider.id, provider);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    };
  }

  get(id: string): DomainScopeProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly DomainScopeProvider[] {
    return [...this.providers.values()].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    );
  }

  info(): readonly ScopeProviderInfo[] {
    return this.list().map((provider) => ({
      id: provider.id,
      title: provider.title,
      enforcement: provider.enforcement,
      builtin: provider.builtin,
    }));
  }

  entryOf(id: string, config: string): ResolvedProviderEntry {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      return {
        id,
        title: id,
        registered: false,
        enforcement: "advisory",
        note: `No scope provider with id "${id}" is registered; its configuration is inert.`,
      };
    }
    let note: string;
    try {
      provider.validate(config);
      note = provider.describe(config);
    } catch (error) {
      note = error instanceof Error ? error.message : String(error);
    }
    return {
      id,
      title: provider.title,
      registered: true,
      enforcement: provider.enforcement,
      note,
    };
  }
}
