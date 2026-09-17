import { IntegrationError } from "../errors.js";
import type { IntegrationProviderId } from "../types.js";
import type { IntegrationProvider } from "./contract.js";

export class IntegrationProviderRegistry {
  private readonly providers = new Map<
    IntegrationProviderId,
    IntegrationProvider
  >();

  register(provider: IntegrationProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Duplicate integration provider: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  /** The provider, or undefined; used where absence is a configuration error. */
  find(id: IntegrationProviderId): IntegrationProvider | undefined {
    return this.providers.get(id);
  }

  get(id: IntegrationProviderId): IntegrationProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Integration provider is unavailable",
      );
    }
    return provider;
  }

  list(): readonly IntegrationProvider[] {
    return [...this.providers.values()];
  }
}
