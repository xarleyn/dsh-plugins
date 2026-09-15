import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  EncryptedSecretRecord,
  IntegrationAuditEntry,
  IntegrationCapability,
  IntegrationFile,
  IntegrationPolicyMode,
  IntegrationPrincipal,
  IntegrationProviderId,
  StoredIntegration,
} from "./types.js";

const EMPTY_FILE: IntegrationFile = Object.freeze({
  version: 1,
  integrations: Object.freeze([]),
  secrets: Object.freeze({}),
  policies: Object.freeze({}),
  audit: Object.freeze([]),
});
const MAX_AUDIT_ENTRIES = 5_000;

function policyKey(integrationId: string, operation: string): string {
  return `${integrationId}:${operation}`;
}

/** Durable plugin-owned store. Every lookup starts from principal + provider. */
export class IntegrationRepository {
  constructor(private readonly filePath: string) {}

  read(): IntegrationFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as IntegrationFile).version !== 1 ||
        !Array.isArray((parsed as IntegrationFile).integrations)
      ) {
        throw new Error("unrecognized integrations store");
      }
      const file = parsed as IntegrationFile;
      return {
        version: 1,
        integrations: file.integrations,
        secrets: file.secrets ?? {},
        policies: file.policies ?? {},
        audit: file.audit ?? [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_FILE;
      throw error;
    }
  }

  find(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): StoredIntegration | undefined {
    return this.read().integrations.find(
      (item) =>
        item.ownerUserId === principal.userId && item.provider === provider,
    );
  }

  secretFor(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): EncryptedSecretRecord | undefined {
    const file = this.read();
    const integration = file.integrations.find(
      (item) =>
        item.ownerUserId === principal.userId && item.provider === provider,
    );
    return integration?.secretRef === null ||
      integration?.secretRef === undefined
      ? undefined
      : file.secrets[integration.secretRef];
  }

  policy(
    integration: StoredIntegration,
    operation: IntegrationCapability,
  ): IntegrationPolicyMode {
    return this.read().policies[policyKey(integration.id, operation)] ?? "deny";
  }

  connect(options: {
    principal: IntegrationPrincipal;
    provider: IntegrationProviderId;
    secret: EncryptedSecretRecord;
    tenantId: string;
    externalUserId: string;
    displayName: string;
    capabilities: readonly IntegrationCapability[];
  }): StoredIntegration {
    const file = this.read();
    const existing = file.integrations.find(
      (item) =>
        item.ownerUserId === options.principal.userId &&
        item.provider === options.provider,
    );
    const now = new Date().toISOString();
    const integration: StoredIntegration = Object.freeze({
      id: existing?.id ?? randomUUID(),
      ownerUserId: options.principal.userId,
      provider: options.provider,
      authKind: "token",
      status: "connected",
      externalTenantId: options.tenantId,
      externalUserId: options.externalUserId,
      displayName: options.displayName,
      capabilities: Object.freeze([...options.capabilities]),
      secretRef: options.secret.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastValidatedAt: now,
      lastErrorCode: null,
    });
    const integrations = file.integrations.filter(
      (item) =>
        item.ownerUserId !== options.principal.userId ||
        item.provider !== options.provider,
    );
    const secrets = { ...file.secrets, [options.secret.id]: options.secret };
    if (existing?.secretRef !== null && existing?.secretRef !== undefined) {
      delete secrets[existing.secretRef];
    }
    const policies = { ...file.policies };
    for (const capability of options.capabilities) {
      policies[policyKey(integration.id, capability)] = "allow";
    }
    this.persist({
      ...file,
      integrations: [...integrations, integration],
      secrets,
      policies,
    });
    return integration;
  }

  updateValidation(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    success: boolean,
    errorCode: string | null,
  ): void {
    const file = this.read();
    const now = new Date().toISOString();
    this.persist({
      ...file,
      integrations: file.integrations.map((item) =>
        item.ownerUserId === principal.userId && item.provider === provider
          ? {
              ...item,
              status: success ? "connected" : "error",
              updatedAt: now,
              lastValidatedAt: success ? now : item.lastValidatedAt,
              lastErrorCode: errorCode,
            }
          : item,
      ),
    });
  }

  setPolicy(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    operation: IntegrationCapability,
    mode: IntegrationPolicyMode,
  ): void {
    const file = this.read();
    const integration = file.integrations.find(
      (item) =>
        item.ownerUserId === principal.userId && item.provider === provider,
    );
    if (integration === undefined) return;
    this.persist({
      ...file,
      policies: {
        ...file.policies,
        [policyKey(integration.id, operation)]: mode,
      },
    });
  }

  disconnect(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): boolean {
    const file = this.read();
    const integration = file.integrations.find(
      (item) =>
        item.ownerUserId === principal.userId && item.provider === provider,
    );
    if (integration === undefined) return false;
    const secrets = { ...file.secrets };
    if (integration.secretRef !== null) delete secrets[integration.secretRef];
    const policies = Object.fromEntries(
      Object.entries(file.policies).filter(
        ([key]) => !key.startsWith(`${integration.id}:`),
      ),
    );
    this.persist({
      ...file,
      integrations: file.integrations.filter(
        (item) => item.id !== integration.id,
      ),
      secrets,
      policies,
    });
    return true;
  }

  audit(entry: Omit<IntegrationAuditEntry, "id" | "createdAt">): void {
    const file = this.read();
    const audit = [
      ...file.audit,
      { ...entry, id: randomUUID(), createdAt: new Date().toISOString() },
    ].slice(-MAX_AUDIT_ENTRIES);
    this.persist({ ...file, audit });
  }

  private persist(file: IntegrationFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, this.filePath);
  }
}
