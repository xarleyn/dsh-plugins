import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationError } from "./errors.js";
import type { IntegrationProviderRegistry } from "./providers/registry.js";
import type { IntegrationRepository } from "./repository.js";
import type { SecretStore } from "./secrets/secret-store.js";
import type {
  CredentialInput,
  IntegrationJsonValue,
  IntegrationPrincipal,
  IntegrationProviderId,
  IntegrationProviderSummary,
  IntegrationSummary,
  IntegrationToolResult,
  PolicyPatch,
} from "./types.js";

/** In-process broker boundary; no caller outside it receives decrypted secrets. */
export class IntegrationBroker {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly secrets: SecretStore,
    private readonly providers: IntegrationProviderRegistry,
    private readonly logger: PluginLogger,
  ) {}

  listProviders(): readonly IntegrationProviderSummary[] {
    return this.providers.list().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      enabled: true,
      authModes: ["token"],
      capabilities: provider.capabilities,
    }));
  }

  list(principal: IntegrationPrincipal): readonly IntegrationSummary[] {
    return this.providers
      .list()
      .map((provider) => this.summary(principal, provider.id));
  }

  summary(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): IntegrationSummary {
    const provider = this.providers.get(providerId);
    const integration = this.repository.find(principal, providerId);
    if (integration === undefined) {
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
        // Nothing is granted yet, so nothing carries a policy either.
        policy: [],
        lastValidatedAt: null,
        errorCode: null,
      };
    }
    const policy = integration.capabilities.map((capability) => ({
      capability,
      mode: this.repository.policy(integration, capability),
    }));
    const secret = this.repository.secretFor(principal, providerId);
    return {
      provider: providerId,
      displayName: provider.displayName,
      status: integration.status,
      portal: integration.externalTenantId,
      externalAccountName: integration.displayName,
      credentialConfigured: secret !== undefined,
      credentialUpdatedAt: secret?.updatedAt ?? null,
      capabilities: integration.capabilities,
      capabilityInfo: provider.capabilityInfo,
      policy,
      lastValidatedAt: integration.lastValidatedAt,
      errorCode: integration.lastErrorCode,
    };
  }

  /** Connect one provider for one principal; the provider owns its credential shape. */
  async connect(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    input: CredentialInput,
  ): Promise<IntegrationSummary> {
    const provider = this.providers.get(providerId);
    const parsed = provider.parseCredential(
      String(input.token ?? ""),
      input.options,
    );
    const validation = await provider.validate({
      credential: parsed.credential,
    });
    const encrypted = await this.secrets.encrypt(parsed.credential, "token");
    this.repository.connect({
      principal,
      provider: providerId,
      secret: encrypted,
      tenantId: validation.tenantId,
      externalUserId: validation.externalUserId,
      displayName: validation.displayName,
      capabilities: validation.capabilities,
    });
    this.repository.audit({
      ownerUserId: principal.userId,
      provider: providerId,
      operation: "credential.connect",
      result: "success",
      sourceSessionId: null,
    });
    this.logger.info("credential.connected", { provider: providerId });
    return this.summary(principal, providerId);
  }

  async validate(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): Promise<IntegrationSummary> {
    const integration = this.requireConnected(principal, providerId);
    try {
      const credential = await this.decrypt(principal, providerId);
      const validation = await this.providers
        .get(providerId)
        .validate({ credential });
      // Re-probe capabilities: a scope granted later at the provider must show up
      // here, and a revoked one must stop being offered. Policies are left
      // untouched, so a newly detected capability starts denied until the user
      // enables it in Settings.
      this.repository.updateValidation(
        principal,
        providerId,
        true,
        null,
        validation.capabilities,
      );
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.validate",
        result: "success",
        sourceSessionId: null,
      });
      return this.summary(principal, providerId);
    } catch (error) {
      const code =
        error instanceof IntegrationError ? error.code : "ProviderUnavailable";
      this.repository.updateValidation(principal, providerId, false, code);
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.validate",
        result: "error",
        sourceSessionId: null,
      });
      this.logger.warn("credential.validation-failed", {
        provider: providerId,
        integrationId: integration.id,
        reason: code,
      });
      throw error;
    }
  }

  patchPolicy(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
    patch: PolicyPatch,
  ): IntegrationSummary {
    const integration = this.requireConnected(principal, providerId);
    if (!integration.capabilities.includes(patch.operation)) {
      throw new IntegrationError("InvalidRequest", "Capability is unavailable");
    }
    if (!(["allow", "confirm", "deny"] as const).includes(patch.mode)) {
      throw new IntegrationError("InvalidRequest", "Policy mode is invalid");
    }
    this.repository.setPolicy(
      principal,
      providerId,
      patch.operation,
      patch.mode,
    );
    return this.summary(principal, providerId);
  }

  disconnect(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): boolean {
    const disconnected = this.repository.disconnect(principal, providerId);
    if (disconnected) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: providerId,
        operation: "credential.disconnect",
        result: "success",
        sourceSessionId: null,
      });
      this.logger.info("credential.disconnected", { provider: providerId });
    }
    return disconnected;
  }

  async call(
    principal: IntegrationPrincipal,
    request: {
      readonly provider: IntegrationProviderId;
      readonly operation: string;
      readonly input: Readonly<Record<string, unknown>>;
      readonly sourceSessionId: string;
    },
  ): Promise<IntegrationToolResult> {
    const integration = this.requireConnected(principal, request.provider);
    const provider = this.providers.get(request.provider);
    const capability = provider.operationCapability(request.operation);
    if (capability === undefined) {
      throw new IntegrationError(
        "InvalidRequest",
        "Unsupported integration operation",
      );
    }
    const mode = this.repository.policy(integration, capability);
    if (mode !== "allow" || !integration.capabilities.includes(capability)) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        result: "denied",
        sourceSessionId: request.sourceSessionId,
      });
      throw new IntegrationError(
        "OperationDeniedByPolicy",
        "Integration operation is denied by policy",
      );
    }
    try {
      const credential = await this.decrypt(principal, request.provider);
      const providerData = await provider.execute(
        {
          credential,
          externalUserId: integration.externalUserId ?? undefined,
        },
        request.operation,
        request.input,
      );
      const data =
        typeof providerData === "object" &&
        providerData !== null &&
        !Array.isArray(providerData)
          ? (providerData as Record<string, IntegrationJsonValue>)
          : { value: providerData as IntegrationJsonValue };
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        result: "success",
        sourceSessionId: request.sourceSessionId,
      });
      this.logger.debug("tool.call", {
        provider: request.provider,
        operation: request.operation,
        status: "success",
      });
      return { provider: request.provider, operation: request.operation, data };
    } catch (error) {
      this.repository.audit({
        ownerUserId: principal.userId,
        provider: request.provider,
        operation: request.operation,
        result: "error",
        sourceSessionId: request.sourceSessionId,
      });
      throw error;
    }
  }

  private requireConnected(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ) {
    const integration = this.repository.find(principal, provider);
    if (
      integration === undefined ||
      integration.status === "revoked" ||
      integration.secretRef === null
    ) {
      throw new IntegrationError(
        "IntegrationNotConnected",
        "Integration is not connected",
      );
    }
    return integration;
  }

  private async decrypt(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): Promise<string> {
    const record = this.repository.secretFor(principal, provider);
    if (record === undefined) {
      throw new IntegrationError(
        "IntegrationNotConnected",
        "Integration is not connected",
      );
    }
    if (
      record.expiresAt !== null &&
      Date.parse(record.expiresAt) <= Date.now()
    ) {
      throw new IntegrationError(
        "CredentialExpired",
        "Integration credential expired",
      );
    }
    try {
      return await this.secrets.decrypt(record);
    } catch {
      throw new IntegrationError(
        "CredentialRevoked",
        "Integration credential is unavailable",
      );
    }
  }
}
