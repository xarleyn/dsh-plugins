import type { MemoryProviderInfo, MemoryRecord } from "../../types.js";
import { DomainExpertsError } from "../errors.js";

const MEMORY_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

export interface MemoryQuery {
  /** Namespaces the caller is allowed to read; already narrowed by policy. */
  readonly namespaces: readonly string[];
  readonly query: string;
  readonly limit: number;
}

/**
 * A memory backend (design §16). The plugin never assumes its own store: a
 * deployment can replace this with OpenViking or another DSH memory plugin
 * without the core changing.
 */
export interface DomainMemoryProvider {
  readonly id: string;
  readonly title: string;
  readonly builtin: boolean;
  listNamespaces(): readonly string[];
  retrieve(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  inspect(namespace: string): Promise<readonly MemoryRecord[]>;
  remember(
    namespace: string,
    key: string,
    text: string,
    tags?: readonly string[],
  ): Promise<MemoryRecord>;
  forget(namespace: string, key: string): Promise<boolean>;
  clear(namespace: string): Promise<number>;
}

export class MemoryProviderRegistry {
  private readonly providers = new Map<string, DomainMemoryProvider>();

  register(provider: DomainMemoryProvider): () => void {
    if (!MEMORY_PROVIDER_ID_PATTERN.test(provider.id)) {
      throw new DomainExpertsError(
        "DOMAIN_INVALID",
        `Memory provider id "${provider.id}" must match ${String(MEMORY_PROVIDER_ID_PATTERN)}.`,
      );
    }
    if (this.providers.has(provider.id)) {
      throw new DomainExpertsError(
        "DOMAIN_INVALID",
        `Memory provider "${provider.id}" is already registered.`,
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

  get(id: string): DomainMemoryProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): DomainMemoryProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new DomainExpertsError(
        "MEMORY_PROVIDER_MISSING",
        `Memory provider "${id}" is not registered. Known providers: ${this.list()
          .map((entry) => entry.id)
          .join(", ") || "(none)"}.`,
        { refs: [id] },
      );
    }
    return provider;
  }

  list(): readonly DomainMemoryProvider[] {
    return [...this.providers.values()].sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    );
  }

  info(): readonly MemoryProviderInfo[] {
    return this.list().map((provider) => ({
      id: provider.id,
      title: provider.title,
      builtin: provider.builtin,
    }));
  }
}
