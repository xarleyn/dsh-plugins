import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";
import type {
  ServiceCredentialHealth,
  ServiceResourceBoundary,
  CredentialSource,
  OperationSecurityMetadata,
} from "../service-credentials/types.js";
import type {
  CapabilityServiceState,
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
  /**
   * Which credential the broker resolved for this call. A provider that supports
   * managed service credentials must treat `service` as a different upstream
   * identity: answers may be attributed to the deployment, not to the user.
   */
  readonly credentialSource?: CredentialSource | undefined;
  /**
   * Boundary every resource this call touches has to stay inside. The broker
   * sets it exactly when the call runs on a managed credential, and a provider
   * that supports service mode fails closed rather than reading outside it —
   * including when the operation is addressed by an opaque id that has to be
   * mapped to a resource first.
   */
  readonly resourceBoundary?: ServiceResourceBoundary | undefined;
}

export interface IntegrationProvider {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[];
  /** Labels and hints for `capabilities`, so clients need no provider catalog. */
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  >;
  /**
   * Where this provider's credential comes from, as it declares it and the
   * deployment may have overridden it; `null` when the deployment hid the help.
   * Metadata only — a credential value never travels in this shape.
   */
  readonly credentialHelp: CredentialHelp | null;
  /**
   * What the deployment got wrong while overriding the help. Non-fatal by
   * design: a broken help address hides a link, it never disables a provider.
   */
  readonly credentialHelpProblems?: readonly string[];
  /** Capability a provider operation needs, or undefined when it is unknown. */
  operationCapability(operation: string): IntegrationCapability | undefined;
  /**
   * Validate and normalize one operator-supplied credential. The provider owns
   * its credential format; the broker only stores the returned opaque string.
   *
   * `options` carries the non-secret choices the connect form made next to the
   * secret — today only which configured instance a token belongs to. It comes
   * from the operator-facing RPC, never from a model tool call.
   *
   * The same method turns a deployment-managed secret into this provider's
   * credential shape, which is why a managed credential and a personal one can
   * never be spent against an instance the other names.
   */
  parseCredential(
    raw: string,
    options?: Readonly<Record<string, string>>,
  ): {
    readonly credential: string;
    readonly portal: string;
  };
  validate(context: ProviderContext): Promise<ProviderValidation>;
  execute(
    context: ProviderContext,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  /**
   * Security classification of one operation. Providers that omit it leave every
   * operation unclassified, and an unclassified operation is unreachable through
   * a managed credential — the default is deny, never guess.
   */
  operationMetadata?(operation: string): OperationSecurityMetadata | undefined;
  /**
   * How one capability behaves when the connection runs on the deployment's
   * managed credential. A provider that omits this supports no managed
   * credential at all, and nothing about the feature appears for it.
   */
  capabilityServiceState?(
    capability: IntegrationCapability,
  ): CapabilityServiceState | undefined;
  /**
   * Which kind of resource an operation reads, in the profile's vocabulary
   * (`projects`, `groups`, …). Used to prove a boundary exists for the operation
   * before it runs; a service-safe operation that declares none is refused.
   */
  resourceBoundaryKind?(operation: string): string | undefined;
  /**
   * Portal of one configured instance, so deployment configuration can name an
   * instance the same way the connect form does and a typo fails at load.
   */
  instancePortal?(instanceId: string): string | undefined;
  /**
   * Probe a deployment-managed credential: is it accepted upstream, what
   * identity does it carry, and is it narrower than read-only. No probe may
   * change upstream state, so a write-capable credential is reported as
   * `unsafe_scope` rather than exercised.
   */
  validateServiceCredential?(
    context: ProviderContext,
  ): Promise<ServiceCredentialHealth>;
}
