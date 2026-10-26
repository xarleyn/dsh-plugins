import type { IntegrationProvider } from "../providers/contract.js";
import type {
  ServiceCredentialProfile,
  ServiceResourceBoundary,
} from "../service-credentials/types.js";
import type {
  CapabilityServiceState,
  EncryptedSecretRecord,
  IntegrationCapability,
  IntegrationServiceSummary,
  IntegrationSummary,
  IntegrationProviderId,
  IntegrationProviderSummary,
  StoredIntegration,
} from "../types.js";

/** Provider discovery exposes descriptive metadata, with no credential. */
export function providerSummary(
  provider: IntegrationProvider,
): IntegrationProviderSummary {
  return {
    id: provider.id,
    displayName: provider.displayName,
    enabled: true,
    authModes: ["token"],
    capabilities: provider.capabilities,
    credentialHelp: provider.credentialHelp,
  };
}

/**
 * The live grant is the stored grant with withdrawn capabilities removed.
 * Call admission, policy edits and operator views use the same intersection.
 */
export function grantedCapabilities(
  integration: Pick<StoredIntegration, "capabilities" | "credentialSource">,
  provider: IntegrationProvider,
  profile?: ServiceCredentialProfile,
): readonly IntegrationCapability[] {
  if (integration.credentialSource === "service")
    return profile?.enabled === true
      ? serviceCapabilities(provider, profile.policy)
      : [];
  return integration.capabilities.filter((capability) =>
    provider.capabilities.includes(capability),
  );
}

/** Capabilities the managed credential can reach through this provider. */
export function serviceCapabilities(
  provider: IntegrationProvider,
  policy?: ServiceCredentialProfile["policy"],
): readonly IntegrationCapability[] {
  if (provider.capabilityServiceState === undefined) return [];
  return provider.capabilities.filter((capability) =>
    ["available", "partial"].includes(
      provider.capabilityServiceState?.(capability, policy) ?? "unavailable",
    ),
  );
}

/** Managed capability states as the operator can see them, without a secret. */
export function serviceCapabilityStates(
  provider: IntegrationProvider,
  policy?: ServiceCredentialProfile["policy"],
): Readonly<Record<string, CapabilityServiceState>> | null {
  if (provider.capabilityServiceState === undefined) return null;
  const capabilities: Record<string, CapabilityServiceState> = {};
  for (const capability of provider.capabilities) {
    capabilities[capability] =
      provider.capabilityServiceState(capability, policy) ?? "unavailable";
  }
  return Object.freeze(capabilities);
}

/**
 * The caller resolves the profile; this projection reads no registry or secret
 * and changes no binding. A provider without service support displays no view.
 */
export function serviceSummary(
  capabilities: Readonly<Record<string, CapabilityServiceState>> | null,
  profile: ServiceCredentialProfile | undefined,
  selection: ServiceResourceBoundary | null,
): IntegrationServiceSummary | null {
  if (capabilities === null) return null;
  return {
    available: profile?.enabled === true,
    label: profile?.label ?? null,
    resources: profile?.resources ?? null,
    selection,
    capabilities,
  };
}

/** A provider with no binding exposes metadata but grants no policy. */
export function disconnectedSummary(
  providerId: IntegrationProviderId,
  provider: IntegrationProvider,
  service: IntegrationServiceSummary | null,
): IntegrationSummary {
  return {
    provider: providerId,
    displayName: provider.displayName,
    status: "not_connected",
    portal: null,
    externalAccountName: null,
    credentialConfigured: false,
    credentialUpdatedAt: null,
    capabilities: provider.capabilities,
    capabilityInfo: provider.capabilityInfo,
    policy: [],
    lastValidatedAt: null,
    errorCode: null,
    credentialSource: "personal",
    service,
  };
}

/** Display one captured binding with its live grant and stored policy. */
export function connectedSummary(
  providerId: IntegrationProviderId,
  provider: IntegrationProvider,
  integration: StoredIntegration,
  granted: readonly IntegrationCapability[],
  policy: IntegrationSummary["policy"],
  secret: Pick<EncryptedSecretRecord, "updatedAt"> | undefined,
  service: IntegrationServiceSummary | null,
): IntegrationSummary {
  return {
    provider: providerId,
    displayName: provider.displayName,
    status: integration.status,
    portal: integration.externalTenantId,
    externalAccountName: integration.displayName,
    credentialConfigured: secret !== undefined,
    credentialUpdatedAt: secret?.updatedAt ?? null,
    capabilities: granted,
    capabilityInfo: provider.capabilityInfo,
    policy,
    lastValidatedAt: integration.lastValidatedAt,
    errorCode: integration.lastErrorCode,
    credentialSource: integration.credentialSource,
    service,
  };
}
