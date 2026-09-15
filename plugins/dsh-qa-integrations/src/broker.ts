import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationError } from "./errors.js";
import { parseBitrixWebhook } from "./providers/bitrix24.js";
import type { IntegrationProviderRegistry } from "./providers/registry.js";
import type { IntegrationRepository } from "./repository.js";
import type { SecretStore } from "./secrets/secret-store.js";
import type {
  CredentialInput,
  IntegrationCapability,
  IntegrationJsonValue,
  IntegrationPrincipal,
  IntegrationProviderId,
  IntegrationProviderSummary,
  IntegrationSummary,
  IntegrationToolResult,
  PolicyPatch,
  ResolvedQaIntegrationsConfig,
} from "./types.js";

const DEFAULT_POLICY: Readonly<
  Record<IntegrationCapability, "allow" | "deny">
> = Object.freeze({ "crm.read": "allow", "chat.read": "allow" });

function requiredCapability(operation: string): IntegrationCapability {
  if (operation.startsWith("crm.")) return "crm.read";
  if (operation.startsWith("chat.")) return "chat.read";
  throw new IntegrationError(
    "InvalidRequest",
    "Unsupported integration operation",
  );
}

/** In-process broker boundary; no caller outside it receives decrypted secrets. */
export class IntegrationBroker {
  constructor(
    private readonly config: ResolvedQaIntegrationsConfig,
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
        policy: DEFAULT_POLICY,
        lastValidatedAt: null,
        errorCode: null,
      };
    }
    const policy = Object.fromEntries(
      provider.capabilities.map((capability) => [
        capability,
        this.repository.policy(integration, capability),
      ]),
    ) as Record<IntegrationCapability, "allow" | "confirm" | "deny">;
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
      policy,
      lastValidatedAt: integration.lastValidatedAt,
      errorCode: integration.lastErrorCode,
    };
  }

  async connectBitrix(
    principal: IntegrationPrincipal,
    input: CredentialInput,
  ): Promise<IntegrationSummary> {
    const parsed = parseBitrixWebhook(
      String(input.token ?? ""),
      this.config.allowedPortalSuffixes,
    );
    const provider = this.providers.get("bitrix24");
    const validation = await provider.validate({
      credential: parsed.credential,
    });
    const encrypted = await this.secrets.encrypt(parsed.credential, "token");
    this.repository.connect({
      principal,
      provider: "bitrix24",
      secret: encrypted,
      tenantId: validation.tenantId,
      externalUserId: validation.externalUserId,
      displayName: validation.displayName,
      capabilities: validation.capabilities,
    });
    this.repository.audit({
      ownerUserId: principal.userId,
      provider: "bitrix24",
      operation: "credential.connect",
      result: "success",
      sourceSessionId: null,
    });
    this.logger.info("credential.connected", { provider: "bitrix24" });
    return this.summary(principal, "bitrix24");
  }

  async validate(
    principal: IntegrationPrincipal,
    providerId: IntegrationProviderId,
  ): Promise<IntegrationSummary> {
    const integration = this.requireConnected(principal, providerId);
    try {
      const credential = await this.decrypt(principal, providerId);
      await this.providers.get(providerId).validate({ credential });
      this.repository.updateValidation(principal, providerId, true, null);
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
    const capability = requiredCapability(request.operation);
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
      const providerData = await this.providers
        .get(request.provider)
        .execute({ credential }, request.operation, request.input);
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
