import type {
  IntegrationCapability,
  IntegrationCapabilityInfo,
  IntegrationProviderId,
  ProviderValidation,
} from "../types.js";

export interface ProviderContext {
  readonly credential: string;
  /**
   * External user id of the credential owner, read from the stored integration.
   * Resolved server-side, never a model argument; it backs "mine" defaults.
   */
  readonly externalUserId?: string | undefined;
}

export interface IntegrationProvider {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[];
  /** Labels and hints for `capabilities`, so clients need no provider catalog. */
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  >;
  /** Capability a provider operation needs, or undefined when it is unknown. */
  operationCapability(operation: string): IntegrationCapability | undefined;
  /**
   * Validate and normalize one operator-supplied credential. The provider owns
   * its credential format; the broker only stores the returned opaque string.
   */
  parseCredential(raw: string): {
    readonly credential: string;
    readonly portal: string;
  };
  validate(context: ProviderContext): Promise<ProviderValidation>;
  execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}
