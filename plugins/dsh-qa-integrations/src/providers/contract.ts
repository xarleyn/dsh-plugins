import type {
  IntegrationCapability,
  IntegrationProviderId,
  ProviderValidation,
} from "../types.js";

export interface ProviderContext {
  readonly credential: string;
}

export interface IntegrationProvider {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[];
  validate(context: ProviderContext): Promise<ProviderValidation>;
  execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}
