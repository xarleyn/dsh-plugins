export type IntegrationProviderId = string;
export type IntegrationAuthKind = "token" | "oauth" | "mcp_token";
export type IntegrationStatus = "pending" | "connected" | "error" | "revoked";
export type IntegrationPolicyMode = "allow" | "confirm" | "deny";

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
}

export interface IntegrationProviderSummary {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly authModes: readonly IntegrationAuthKind[];
  readonly capabilities: readonly IntegrationCapability[];
}

export interface CredentialInput {
  /** Write-only credential; never appears in a response. */
  readonly token: string;
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
  readonly secretRef: string | null;
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
  readonly ownerUserId: string;
  readonly provider: IntegrationProviderId;
  readonly operation: string;
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
