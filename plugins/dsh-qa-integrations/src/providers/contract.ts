import type {
  IntegrationCapability,
  IntegrationProviderId,
  ProviderValidation,
} from "../types.js";

export interface ProviderContext {
  readonly credential: string;
  /**
   * Bitrix user id of the credential owner, read from the stored integration.
   * Resolved server-side, never a model argument; it backs "mine" defaults.
   */
  readonly externalUserId?: string | undefined;
}

export interface IntegrationProvider {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[];
  /** Capability a provider operation needs, or undefined when it is unknown. */
  operationCapability(operation: string): IntegrationCapability | undefined;
  validate(context: ProviderContext): Promise<ProviderValidation>;
  execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}
