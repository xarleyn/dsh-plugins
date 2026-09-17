import { randomUUID } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import {
  SqliteDatabase,
  type SqliteMigration,
} from "@yadsh/dsh-plugin-kit/sqlite";
import type {
  CredentialSource,
  EncryptedSecretRecord,
  IntegrationAuditEntry,
  IntegrationCapability,
  IntegrationFile,
  IntegrationPolicyMode,
  IntegrationPrincipal,
  IntegrationProviderId,
  IntegrationServiceBoundary,
  StoredIntegration,
} from "./types.js";

/** The store keeps this many audit rows, whatever the age bound says. */
const MAX_AUDIT_ENTRIES = 5_000;
/** Audit rows older than this are dropped on the next write; 0 keeps all. */
const DEFAULT_AUDIT_RETENTION_DAYS = 90;

const MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE integrations (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        auth_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        external_tenant_id TEXT,
        external_user_id TEXT,
        display_name TEXT,
        capabilities_json TEXT NOT NULL,
        secret_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_validated_at TEXT,
        last_error_code TEXT
      );
      -- One connection per account and provider: the pair the repository is
      -- always addressed by, and the one that must not be duplicated.
      CREATE UNIQUE INDEX integrations_owner_provider
        ON integrations (owner_user_id, provider);

      CREATE TABLE integration_secrets (
        id TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        wrapped_dek TEXT NOT NULL,
        wrap_nonce TEXT NOT NULL,
        wrap_auth_tag TEXT NOT NULL,
        key_version INTEGER NOT NULL,
        secret_type TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE integration_policies (
        integration_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        mode TEXT NOT NULL,
        PRIMARY KEY (integration_id, operation)
      );

      -- Append-only, and the one table that grows with usage rather than with
      -- configuration: an audit row lands per tool call. Ordered by insertion
      -- so the newest can be kept without parsing the log.
      CREATE TABLE integration_audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        result TEXT NOT NULL,
        source_session_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX integration_audit_created ON integration_audit (created_at);
    `,
  },
  {
    version: 2,
    up: `
      -- Which credential a binding spends, and the managed profile it resolves
      -- to. Existing connections default to their own credential: an upgrade
      -- must never move a user onto a shared account.
      ALTER TABLE integrations ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'personal';
      ALTER TABLE integrations ADD COLUMN service_profile_id TEXT;
      ALTER TABLE integrations ADD COLUMN binding_revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE integrations ADD COLUMN service_selection_json TEXT;
      ALTER TABLE integrations ADD COLUMN service_policy_revision TEXT;

      -- Upstream sees only the service account in service mode, so the local
      -- trail is the one that answers "which real user did this".
      ALTER TABLE integration_audit ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'personal';
      ALTER TABLE integration_audit ADD COLUMN service_profile_id TEXT;

      -- A capability split is applied by expandCapabilities, which the
      -- composition root calls with the provider's rename map: this module
      -- knows the shape of a store, not the name of a provider.
    `,
  },
];

/** SQLite hands back null-prototype records; the row shapes describe them. */
function asRows<T>(value: unknown): T[] {
  return value as T[];
}

interface IntegrationRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly provider: string;
  readonly auth_kind: string;
  readonly status: string;
  readonly external_tenant_id: string | null;
  readonly external_user_id: string | null;
  readonly display_name: string | null;
  readonly capabilities_json: string;
  readonly secret_ref: string | null;
  readonly credential_source: string;
  readonly service_profile_id: string | null;
  readonly binding_revision: number;
  readonly service_selection_json: string | null;
  readonly service_policy_revision: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_validated_at: string | null;
  readonly last_error_code: string | null;
}

interface SecretRow {
  readonly id: string;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly auth_tag: string;
  readonly wrapped_dek: string;
  readonly wrap_nonce: string;
  readonly wrap_auth_tag: string;
  readonly key_version: number;
  readonly secret_type: string;
  readonly expires_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AuditRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly provider: string;
  readonly operation: string;
  readonly result: string;
  readonly credential_source: string;
  readonly service_profile_id: string | null;
  readonly source_session_id: string | null;
  readonly created_at: string;
}

function toIntegration(row: IntegrationRow): StoredIntegration {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    provider: row.provider as IntegrationProviderId,
    authKind: row.auth_kind as StoredIntegration["authKind"],
    status: row.status as StoredIntegration["status"],
    externalTenantId: row.external_tenant_id,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    capabilities: Object.freeze(
      JSON.parse(row.capabilities_json) as IntegrationCapability[],
    ),
    secretRef: row.secret_ref,
    credentialSource: row.credential_source as CredentialSource,
    serviceProfileId: row.service_profile_id,
    bindingRevision: row.binding_revision,
    serviceSelection: boundaryOf(row.service_selection_json),
    servicePolicyRevision: row.service_policy_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastValidatedAt: row.last_validated_at,
    lastErrorCode: row.last_error_code,
  };
}

function toSecret(row: SecretRow): EncryptedSecretRecord {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authTag: row.auth_tag,
    wrappedDek: row.wrapped_dek,
    wrapNonce: row.wrap_nonce,
    wrapAuthTag: row.wrap_auth_tag,
    keyVersion: row.key_version,
    secretType: row.secret_type as EncryptedSecretRecord["secretType"],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAuditEntry(row: AuditRow): IntegrationAuditEntry {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    provider: row.provider as IntegrationProviderId,
    operation: row.operation,
    result: row.result as IntegrationAuditEntry["result"],
    credentialSource: row.credential_source as CredentialSource,
    serviceProfileId: row.service_profile_id,
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
  };
}

/** Stored boundary JSON, or null when the binder narrows nothing. */
function boundaryOf(value: string | null): IntegrationServiceBoundary | null {
  if (value === null || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const boundary: Record<string, readonly string[]> = {};
    for (const [kind, refs] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!Array.isArray(refs)) return null;
      boundary[kind] = Object.freeze(
        refs.filter((ref): ref is string => typeof ref === "string"),
      );
    }
    return Object.freeze(boundary);
  } catch {
    return null;
  }
}

function boundaryJson(
  boundary: IntegrationServiceBoundary | null | undefined,
): string | null {
  return boundary === null || boundary === undefined
    ? null
    : JSON.stringify(boundary);
}

function policyKey(integrationId: string, operation: string): string {
  return `${integrationId}:${operation}`;
}

/**
 * Durable plugin-owned store, as tables. Every lookup starts from principal +
 * provider, which is the pair the unique index covers, so a lookup reads the
 * one row it needs instead of parsing the whole store — including the audit
 * log, which was inside the same document as the connections.
 *
 * The audit trail is the part that grows with usage, so it is bounded twice
 * over: a hard row count, and an age bound the operator can set. Rows are
 * deleted as a set on the next write rather than rewritten per row.
 */
export class IntegrationRepository {
  private readonly storage: SqliteDatabase;
  private readonly auditRetentionDays: number;

  constructor(
    filePath: string,
    options: { readonly auditRetentionDays?: number } = {},
  ) {
    this.storage = new SqliteDatabase(filePath, MIGRATIONS);
    this.auditRetentionDays =
      options.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  }

  close(): void {
    this.storage.close();
  }

  /** The whole store, for maintenance surfaces that need the aggregate. */
  read(): IntegrationFile {
    const integrations = asRows<IntegrationRow>(
      this.storage.db.prepare("SELECT * FROM integrations").all(),
    ).map(toIntegration);
    const secrets = asRows<SecretRow>(
      this.storage.db.prepare("SELECT * FROM integration_secrets").all(),
    ).map(toSecret);
    const policies = asRows<{
      integration_id: string;
      operation: string;
      mode: string;
    }>(this.storage.db.prepare("SELECT * FROM integration_policies").all());
    const audit = asRows<AuditRow>(
      this.storage.db
        .prepare("SELECT * FROM integration_audit ORDER BY seq")
        .all(),
    ).map(toAuditEntry);
    return {
      version: 1,
      integrations,
      secrets: Object.fromEntries(secrets.map((secret) => [secret.id, secret])),
      policies: Object.fromEntries(
        policies.map((policy) => [
          policyKey(policy.integration_id, policy.operation),
          policy.mode as IntegrationPolicyMode,
        ]),
      ),
      audit,
    };
  }

  find(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): StoredIntegration | undefined {
    const row = this.storage.db
      .prepare(
        "SELECT * FROM integrations WHERE owner_user_id = ? AND provider = ?",
      )
      .get(principal.userId, provider) as IntegrationRow | undefined;
    return row === undefined ? undefined : toIntegration(row);
  }

  secretFor(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): EncryptedSecretRecord | undefined {
    const row = this.storage.db
      .prepare(
        `SELECT s.* FROM integration_secrets s
           JOIN integrations i ON i.secret_ref = s.id
          WHERE i.owner_user_id = ? AND i.provider = ?`,
      )
      .get(principal.userId, provider) as SecretRow | undefined;
    return row === undefined ? undefined : toSecret(row);
  }

  policy(
    integration: StoredIntegration,
    operation: IntegrationCapability,
  ): IntegrationPolicyMode {
    const row = this.storage.db
      .prepare(
        "SELECT mode FROM integration_policies WHERE integration_id = ? AND operation = ?",
      )
      .get(integration.id, operation) as { mode: string } | undefined;
    return (row?.mode as IntegrationPolicyMode | undefined) ?? "deny";
  }

  connect(options: {
    principal: IntegrationPrincipal;
    provider: IntegrationProviderId;
    /**
     * The personal credential, or null when this connection is created in
     * service mode. A connection that runs on the managed credential keeps any
     * personal credential it already had, inactive: it is never a fallback, but
     * the user can switch back without minting a new token.
     */
    secret: EncryptedSecretRecord | null;
    tenantId: string;
    externalUserId: string;
    displayName: string;
    capabilities: readonly IntegrationCapability[];
    credentialSource?: CredentialSource;
    serviceProfileId?: string | null;
  }): StoredIntegration {
    return this.storage.transaction(() => {
      const existing = this.find(options.principal, options.provider);
      const now = new Date().toISOString();
      const credentialSource = options.credentialSource ?? "personal";
      const serviceProfileId =
        credentialSource === "service"
          ? (options.serviceProfileId ?? null)
          : null;
      // Switching credential mode bumps the binding revision, which is what
      // everything derived from the previous identity is keyed by.
      const switched =
        existing !== undefined &&
        existing.credentialSource !== credentialSource;
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
        secretRef:
          options.secret === null
            ? (existing?.secretRef ?? null)
            : options.secret.id,
        credentialSource,
        serviceProfileId,
        bindingRevision: (existing?.bindingRevision ?? 1) + (switched ? 1 : 0),
        serviceSelection:
          serviceProfileId !== null &&
          serviceProfileId === existing?.serviceProfileId
            ? (existing?.serviceSelection ?? null)
            : null,
        servicePolicyRevision: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastValidatedAt: now,
        lastErrorCode: null,
      });
      // A reconnect replaces the credential: the previous one is dropped with
      // the row that referenced it, so no stale secret stays readable.
      if (options.secret !== null) {
        if (
          existing?.secretRef !== null &&
          existing?.secretRef !== undefined &&
          existing.secretRef !== options.secret.id
        ) {
          this.storage.db
            .prepare("DELETE FROM integration_secrets WHERE id = ?")
            .run(existing.secretRef);
        }
        this.writeSecret(options.secret);
      }
      this.storage.db
        .prepare(
          `INSERT INTO integrations
             (id, owner_user_id, provider, auth_kind, status, external_tenant_id,
              external_user_id, display_name, capabilities_json, secret_ref,
              credential_source, service_profile_id, binding_revision,
              service_selection_json, service_policy_revision,
              created_at, updated_at, last_validated_at, last_error_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             external_tenant_id = excluded.external_tenant_id,
             external_user_id = excluded.external_user_id,
             display_name = excluded.display_name,
             capabilities_json = excluded.capabilities_json,
             secret_ref = excluded.secret_ref,
             credential_source = excluded.credential_source,
             service_profile_id = excluded.service_profile_id,
             binding_revision = excluded.binding_revision,
             service_selection_json = excluded.service_selection_json,
             service_policy_revision = excluded.service_policy_revision,
             updated_at = excluded.updated_at,
             last_validated_at = excluded.last_validated_at,
             last_error_code = excluded.last_error_code`,
        )
        .run(
          integration.id,
          integration.ownerUserId,
          integration.provider,
          integration.authKind,
          integration.status,
          integration.externalTenantId,
          integration.externalUserId,
          integration.displayName,
          JSON.stringify(integration.capabilities),
          integration.secretRef,
          integration.credentialSource,
          integration.serviceProfileId,
          integration.bindingRevision,
          boundaryJson(integration.serviceSelection),
          integration.servicePolicyRevision,
          integration.createdAt,
          integration.updatedAt,
          integration.lastValidatedAt,
          integration.lastErrorCode,
        );
      const setPolicy = this.storage.db.prepare(
        `INSERT INTO integration_policies (integration_id, operation, mode)
         VALUES (?, ?, 'allow')
         ON CONFLICT(integration_id, operation) DO UPDATE SET mode = 'allow'`,
      );
      for (const capability of options.capabilities) {
        setPolicy.run(integration.id, capability);
      }
      return integration;
    });
  }

  updateValidation(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    success: boolean,
    errorCode: string | null,
    capabilities?: readonly IntegrationCapability[],
  ): void {
    this.storage.transaction(() => {
      const existing = this.find(principal, provider);
      if (existing === undefined) return;
      const now = new Date().toISOString();
      this.storage.db
        .prepare(
          `UPDATE integrations
              SET status = ?, updated_at = ?, last_validated_at = ?,
                  last_error_code = ?, capabilities_json = ?
            WHERE id = ?`,
        )
        .run(
          success ? "connected" : "error",
          now,
          success ? now : existing.lastValidatedAt,
          errorCode,
          JSON.stringify(
            success && capabilities !== undefined
              ? [...capabilities]
              : existing.capabilities,
          ),
          existing.id,
        );
    });
  }

  /**
   * Move a binding between credential sources without touching upstream. The
   * binding revision is bumped, so everything derived from the previous identity
   * — caches, cursors, prepared actions — is stale from this moment on; the
   * personal credential, if there is one, stays stored but unused.
   */
  setCredentialSource(options: {
    principal: IntegrationPrincipal;
    provider: IntegrationProviderId;
    source: CredentialSource;
    serviceProfileId: string | null;
    capabilities: readonly IntegrationCapability[];
    tenantId: string;
    externalUserId: string;
    displayName: string;
  }): StoredIntegration | undefined {
    return this.storage.transaction(() => {
      const existing = this.find(options.principal, options.provider);
      if (existing === undefined) return undefined;
      const now = new Date().toISOString();
      const profileChanged =
        options.serviceProfileId !== existing.serviceProfileId;
      this.storage.db
        .prepare(
          `UPDATE integrations
              SET credential_source = ?, service_profile_id = ?,
                  binding_revision = ?, service_selection_json = ?,
                  service_policy_revision = NULL,
                  capabilities_json = ?, external_tenant_id = ?,
                  external_user_id = ?, display_name = ?, updated_at = ?,
                  last_validated_at = ?, last_error_code = NULL
            WHERE id = ?`,
        )
        .run(
          options.source,
          options.serviceProfileId,
          existing.bindingRevision + 1,
          profileChanged ? null : boundaryJson(existing.serviceSelection),
          JSON.stringify(options.capabilities),
          options.tenantId,
          options.externalUserId,
          options.displayName,
          now,
          now,
          existing.id,
        );
      return this.find(options.principal, options.provider);
    });
  }

  /** Store what this binding narrows the profile's allowlist to. */
  setServiceSelection(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    selection: IntegrationServiceBoundary | null,
  ): void {
    this.storage.transaction(() => {
      const integration = this.find(principal, provider);
      if (integration === undefined) return;
      this.storage.db
        .prepare(
          "UPDATE integrations SET service_selection_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(boundaryJson(selection), new Date().toISOString(), integration.id);
    });
  }

  /** Record which profile revision the binding was last resolved against. */
  setServicePolicyRevision(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    revision: string,
  ): void {
    this.storage.transaction(() => {
      const integration = this.find(principal, provider);
      if (integration === undefined) return;
      this.storage.db
        .prepare(
          "UPDATE integrations SET service_policy_revision = ? WHERE id = ?",
        )
        .run(revision, integration.id);
    });
  }

  setPolicy(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    operation: IntegrationCapability,
    mode: IntegrationPolicyMode,
  ): void {
    this.storage.transaction(() => {
      const integration = this.find(principal, provider);
      if (integration === undefined) return;
      this.storage.db
        .prepare(
          `INSERT INTO integration_policies (integration_id, operation, mode)
           VALUES (?, ?, ?)
           ON CONFLICT(integration_id, operation) DO UPDATE SET mode = excluded.mode`,
        )
        .run(integration.id, operation, mode);
    });
  }

  disconnect(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
  ): boolean {
    return this.storage.transaction(() => {
      const integration = this.find(principal, provider);
      if (integration === undefined) return false;
      this.storage.db
        .prepare("DELETE FROM integration_policies WHERE integration_id = ?")
        .run(integration.id);
      this.storage.db
        .prepare("DELETE FROM integrations WHERE id = ?")
        .run(integration.id);
      if (integration.secretRef !== null) {
        this.storage.db
          .prepare("DELETE FROM integration_secrets WHERE id = ?")
          .run(integration.secretRef);
      }
      return true;
    });
  }

  audit(
    entry: Omit<
      IntegrationAuditEntry,
      "id" | "createdAt" | "credentialSource" | "serviceProfileId"
    > &
      Partial<
        Pick<IntegrationAuditEntry, "credentialSource" | "serviceProfileId">
      >,
  ): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare(
          `INSERT INTO integration_audit
             (id, owner_user_id, provider, operation, result, credential_source,
              service_profile_id, source_session_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          entry.ownerUserId,
          entry.provider,
          entry.operation,
          entry.result,
          entry.credentialSource ?? "personal",
          entry.serviceProfileId ?? null,
          entry.sourceSessionId,
          new Date().toISOString(),
        );
      this.applyAuditRetention();
    });
  }

  /**
   * Widen stored capability lists whose ids a provider has since split, copying
   * each legacy policy onto every id that replaced it. A provider-agnostic
   * repair driven by the composition root: it is idempotent, so running it on
   * every start costs one scan and changes nothing once applied.
   */
  expandCapabilities(
    renames: Readonly<Record<string, readonly string[]>>,
  ): void {
    const entries = Object.entries(renames).filter(
      ([from, to]) => from !== "" && to.length > 0,
    );
    if (entries.length === 0) return;
    this.storage.transaction(() => {
      const rows = asRows<IntegrationRow>(
        this.storage.db.prepare("SELECT * FROM integrations").all(),
      );
      for (const row of rows) {
        const capabilities = JSON.parse(
          row.capabilities_json,
        ) as IntegrationCapability[];
        const next: IntegrationCapability[] = [];
        const replaced: string[] = [];
        for (const capability of capabilities) {
          const replacement = renames[capability];
          if (replacement === undefined) {
            next.push(capability);
            continue;
          }
          replaced.push(capability);
          for (const id of replacement) {
            if (!next.includes(id)) next.push(id);
          }
        }
        if (replaced.length === 0) continue;
        if (next.length !== capabilities.length) {
          this.storage.db
            .prepare(
              "UPDATE integrations SET capabilities_json = ?, updated_at = ? WHERE id = ?",
            )
            .run(JSON.stringify(next), new Date().toISOString(), row.id);
        }
        for (const legacy of replaced) {
          for (const id of renames[legacy] ?? []) {
            this.storage.db
              .prepare(
                `INSERT INTO integration_policies (integration_id, operation, mode)
                   SELECT ?, ?, mode FROM integration_policies
                    WHERE integration_id = ? AND operation = ?
                   ON CONFLICT DO NOTHING`,
              )
              .run(row.id, id, row.id, legacy);
          }
          this.storage.db
            .prepare(
              "DELETE FROM integration_policies WHERE integration_id = ? AND operation = ?",
            )
            .run(row.id, legacy);
        }
      }
    });
  }

  /**
   * Import a pre-SQLite `qa-integrations.json` exactly once, then rename it
   * aside. A database that already holds a connection is never overwritten by
   * a leftover file: the operator's live credential wins.
   */
  importLegacyFile(legacyFilePath: string | undefined): void {
    if (legacyFilePath === undefined) return;
    let raw: string;
    try {
      raw = readFileSync(legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as IntegrationFile).version !== 1 ||
      !Array.isArray((parsed as IntegrationFile).integrations)
    ) {
      throw new Error(
        `qa-integrations: ${legacyFilePath} is not a recognizable integrations store; refusing to import it`,
      );
    }
    const file = parsed as IntegrationFile;
    const existing = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM integrations")
      .get() as { count: number };
    if (existing.count > 0) return;
    this.storage.transaction(() => {
      for (const secret of Object.values(file.secrets ?? {})) {
        this.writeSecret(secret);
      }
      const insert = this.storage.db.prepare(
        `INSERT INTO integrations
           (id, owner_user_id, provider, auth_kind, status, external_tenant_id,
            external_user_id, display_name, capabilities_json, secret_ref,
            created_at, updated_at, last_validated_at, last_error_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of file.integrations) {
        insert.run(
          item.id,
          item.ownerUserId,
          item.provider,
          item.authKind,
          item.status,
          item.externalTenantId,
          item.externalUserId,
          item.displayName,
          JSON.stringify(item.capabilities ?? []),
          item.secretRef,
          item.createdAt,
          item.updatedAt,
          item.lastValidatedAt,
          item.lastErrorCode,
        );
      }
      const setPolicy = this.storage.db.prepare(
        `INSERT INTO integration_policies (integration_id, operation, mode)
         VALUES (?, ?, ?)
         ON CONFLICT(integration_id, operation) DO UPDATE SET mode = excluded.mode`,
      );
      for (const [key, mode] of Object.entries(file.policies ?? {})) {
        const separator = key.indexOf(":");
        if (separator <= 0) continue;
        setPolicy.run(key.slice(0, separator), key.slice(separator + 1), mode);
      }
      const insertAudit = this.storage.db.prepare(
        `INSERT INTO integration_audit
           (id, owner_user_id, provider, operation, result, source_session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const entry of file.audit ?? []) {
        insertAudit.run(
          entry.id,
          entry.ownerUserId,
          entry.provider,
          entry.operation,
          entry.result,
          entry.sourceSessionId,
          entry.createdAt,
        );
      }
      this.applyAuditRetention();
      this.assertImportArrived(file);
    });
    renameSync(
      legacyFilePath,
      `${legacyFilePath}.migrated-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
    );
  }

  private assertImportArrived(file: IntegrationFile): void {
    const integrations = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM integrations")
      .get() as { count: number };
    const secrets = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM integration_secrets")
      .get() as { count: number };
    const problems: string[] = [];
    if (integrations.count !== file.integrations.length) {
      problems.push(
        `expected ${file.integrations.length} connections, imported ${integrations.count}`,
      );
    }
    const expectedSecrets = Object.keys(file.secrets ?? {}).length;
    if (secrets.count !== expectedSecrets) {
      problems.push(
        `expected ${expectedSecrets} credentials, imported ${secrets.count}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `qa-integrations: importing the pre-SQLite store failed verification (${problems.join("; ")}); the file is left in place and the import was rolled back`,
      );
    }
  }

  private writeSecret(secret: EncryptedSecretRecord): void {
    this.storage.db
      .prepare(
        `INSERT INTO integration_secrets
           (id, ciphertext, nonce, auth_tag, wrapped_dek, wrap_nonce,
            wrap_auth_tag, key_version, secret_type, expires_at, created_at,
            updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           nonce = excluded.nonce,
           auth_tag = excluded.auth_tag,
           wrapped_dek = excluded.wrapped_dek,
           wrap_nonce = excluded.wrap_nonce,
           wrap_auth_tag = excluded.wrap_auth_tag,
           key_version = excluded.key_version,
           secret_type = excluded.secret_type,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        secret.id,
        secret.ciphertext,
        secret.nonce,
        secret.authTag,
        secret.wrappedDek,
        secret.wrapNonce,
        secret.wrapAuthTag,
        secret.keyVersion,
        secret.secretType,
        secret.expiresAt,
        secret.createdAt,
        secret.updatedAt,
      );
  }

  /** Keep the newest rows, then the youngest ones. */
  private applyAuditRetention(): void {
    if (this.auditRetentionDays > 0) {
      const cutoff = new Date(
        Date.now() - this.auditRetentionDays * 86_400_000,
      ).toISOString();
      this.storage.db
        .prepare("DELETE FROM integration_audit WHERE created_at < ?")
        .run(cutoff);
    }
    this.storage.db
      .prepare(
        `DELETE FROM integration_audit
          WHERE seq <= (
            SELECT MAX(seq) - ? FROM integration_audit
          )`,
      )
      .run(MAX_AUDIT_ENTRIES);
  }
}
