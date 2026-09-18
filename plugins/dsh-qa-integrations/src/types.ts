import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

export type IntegrationProviderId = string;
export type IntegrationAuthKind = "token" | "oauth" | "mcp_token";
export type IntegrationStatus = "pending" | "connected" | "error" | "revoked";
export type IntegrationPolicyMode = "allow" | "confirm" | "deny";

/**
 * Which credential the broker spends for one binding. Declared here rather than
 * next to the service-credential machinery because it is part of the stored
 * connection and of every summary a client renders.
 */
export type CredentialSource = "personal" | "service";

/**
 * How one capability behaves when the connection runs on the deployment's
 * managed credential. Derived from the provider's operation classifications, so
 * a client can explain a switched-off row instead of showing a bare deny.
 */
export type CapabilityServiceState =
  /** Every operation of this capability is service-safe. */
  | "available"
  /** At least one operation returns sensitive data: needs a personal account. */
  | "sensitive"
  /** At least one operation is a write, an admin action or explicitly denied. */
  | "unavailable";

/**
 * Capability id, free-form on purpose: every provider declares its own set in
 * its own catalog (`providers/<id>/catalog.ts`) and this framework only moves
 * ids around. A capability exists for a user when the deployment enables it AND
 * the connected credential really grants it, so the Settings card never offers
 * the agent more than the external service allows.
 */
export type IntegrationCapability = string;

/** How a capability is presented to the user; supplied by its provider. */
export interface IntegrationCapabilityInfo {
  readonly label: string;
  readonly hint: string;
}

/** Effective policy of one granted capability. */
export interface IntegrationPolicyEntry {
  readonly capability: IntegrationCapability;
  readonly mode: IntegrationPolicyMode;
}

export interface IntegrationPrincipal {
  readonly userId: string;
}

/**
 * The managed-credential side of one provider for one principal: whether the
 * deployment offers a service credential for the connected instance, what it
 * may read, and what it can never read. Safe to render and to log — it carries
 * an administrator-chosen alias, never a secret.
 */
export interface IntegrationServiceSummary {
  /** A profile exists for this provider instance and is not disabled. */
  readonly available: boolean;
  /** Safe alias of the profile, such as "QA Read-only". */
  readonly label: string | null;
  /** Administrator allowlist, so a user can narrow their own access. */
  readonly resources: IntegrationServiceBoundary | null;
  /** What this connection narrowed that allowlist to, or null for all of it. */
  readonly selection: IntegrationServiceBoundary | null;
  /** Service-mode behaviour of every capability the provider declares. */
  readonly capabilities: Readonly<
    Record<IntegrationCapability, CapabilityServiceState>
  >;
}

/**
 * Resource allowlist of a managed credential, keyed by provider vocabulary
 * (`projects`, `groups`, …). Values are the identifiers the provider itself
 * accepts in a call, so a boundary entry and a tool argument are compared as
 * strings and never through a display name.
 */
export type IntegrationServiceBoundary = Readonly<
  Record<string, readonly string[]>
>;

/** Identity upstream reports for a managed credential, safe to show and log. */
export interface SafeExternalIdentity {
  readonly id: string;
  readonly label: string;
}

export type ServiceCredentialStatus =
  /** Reachable and, as far as the provider can tell, free of mutable scopes. */
  | "healthy"
  /** Expired upstream; nothing is served and the operator must rotate. */
  | "expired"
  /** Rejected upstream; nothing is served. */
  | "revoked"
  /** Reachable, but wider than read-only; the local ceiling still applies. */
  | "unsafe_scope"
  /** The service could not be reached, or the secret could not be read. */
  | "unreachable";

/**
 * What a probe of a managed credential found. Declared here because it crosses
 * the remote boundary: it carries a status and operator warnings, never a secret
 * and never the upstream identity the credential holds.
 */
export interface ServiceCredentialHealth {
  readonly status: ServiceCredentialStatus;
  readonly upstreamIdentity?: SafeExternalIdentity | undefined;
  readonly grantedScopes?: readonly string[] | undefined;
  readonly warnings?: readonly string[] | undefined;
}

/** One configured instance, and whether a service credential covers it. */
export interface IntegrationInstanceSummary {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  /** Safe alias of the managed credential bound to this instance, if any. */
  readonly service: { readonly label: string } | null;
}

export interface IntegrationSummary {
  readonly provider: IntegrationProviderId;
  readonly displayName: string;
  readonly status: IntegrationStatus | "not_connected";
  readonly portal: string | null;
  readonly externalAccountName: string | null;
  readonly credentialConfigured: boolean;
  readonly credentialUpdatedAt: string | null;
  readonly capabilities: readonly IntegrationCapability[];
  /**
   * Labels and hints for every capability the provider declares, so a client
   * can render a provider it has never heard of.
   */
  readonly capabilityInfo: Readonly<
    Record<IntegrationCapability, IntegrationCapabilityInfo>
  >;
  /**
   * Effective policy of every capability the connected credential grants; a
   * capability outside this list is not granted at all.
   */
  readonly policy: readonly IntegrationPolicyEntry[];
  readonly lastValidatedAt: string | null;
  readonly errorCode: string | null;
  /** Which credential the next call will spend. */
  readonly credentialSource: CredentialSource;
  /** Effective managed-credential state, or null when the provider has none. */
  readonly service: IntegrationServiceSummary | null;
}

export interface IntegrationProviderSummary {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly authModes: readonly IntegrationAuthKind[];
  readonly capabilities: readonly IntegrationCapability[];
  /**
   * Where the credential for this provider comes from, as the provider declares
   * it and the deployment may have overridden it. Metadata only: it never
   * carries a credential value, and `null` means the card shows the plain field.
   */
  readonly credentialHelp: CredentialHelp | null;
}

export interface CredentialInput {
  /** Write-only credential; never appears in a response. */
  readonly token: string;
  /**
   * Non-secret choices made next to the secret in the connect form, such as
   * which configured instance the token belongs to. Operator-facing only.
   */
  readonly options?: Readonly<Record<string, string>>;
}

export interface PolicyPatch {
  readonly operation: IntegrationCapability;
  readonly mode: IntegrationPolicyMode;
}

export interface StoredIntegration {
  readonly id: string;
  readonly ownerUserId: string;
  readonly provider: IntegrationProviderId;
  readonly authKind: IntegrationAuthKind;
  readonly status: IntegrationStatus;
  readonly externalTenantId: string | null;
  readonly externalUserId: string | null;
  readonly displayName: string | null;
  readonly capabilities: readonly IntegrationCapability[];
  /** Personal credential, kept while the binding runs in service mode. */
  readonly secretRef: string | null;
  /** Which credential this binding spends; `personal` unless switched. */
  readonly credentialSource: CredentialSource;
  /** Managed profile this binding resolves to, when it runs in service mode. */
  readonly serviceProfileId: string | null;
  /**
   * Incremented on every credential-mode switch. Cache keys, cursors and pending
   * actions are bound to it, so switching modes invalidates them all at once.
   */
  readonly bindingRevision: number;
  /** What this binding narrows the profile's allowlist to, if anything. */
  readonly serviceSelection: IntegrationServiceBoundary | null;
  /** Policy revision of the profile the binding was last resolved against. */
  readonly servicePolicyRevision: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastValidatedAt: string | null;
  readonly lastErrorCode: string | null;
}

export interface EncryptedSecretRecord {
  readonly id: string;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly authTag: string;
  readonly wrappedDek: string;
  readonly wrapNonce: string;
  readonly wrapAuthTag: string;
  readonly keyVersion: number;
  readonly secretType: IntegrationAuthKind;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationAuditEntry {
  readonly id: string;
  /**
   * The authenticated QA user the call belongs to. In service mode upstream
   * only ever sees the deployment's account, so this column is what answers
   * "which real user did this".
   */
  readonly ownerUserId: string;
  readonly provider: IntegrationProviderId;
  readonly operation: string;
  /** Which credential the call was attributed to. */
  readonly credentialSource: CredentialSource;
  /** Safe profile id, never a secret; null for a personal call. */
  readonly serviceProfileId: string | null;
  readonly result: "success" | "denied" | "error";
  readonly sourceSessionId: string | null;
  readonly createdAt: string;
}

export interface IntegrationFile {
  readonly version: 1;
  readonly integrations: readonly StoredIntegration[];
  readonly secrets: Readonly<Record<string, EncryptedSecretRecord>>;
  readonly policies: Readonly<Record<string, IntegrationPolicyMode>>;
  readonly audit: readonly IntegrationAuditEntry[];
}

export interface ProviderValidation {
  readonly tenantId: string;
  readonly externalUserId: string;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[];
}

export type IntegrationJsonValue =
  | null
  | boolean
  | number
  | string
  | IntegrationJsonValue[]
  | { [key: string]: IntegrationJsonValue };

export interface IntegrationToolResult {
  readonly provider: IntegrationProviderId;
  readonly operation: string;
  readonly data: Record<string, IntegrationJsonValue>;
}
