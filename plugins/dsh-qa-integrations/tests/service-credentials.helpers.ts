import { randomBytes } from "node:crypto";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationBroker } from "../src/broker.js";
import { IntegrationError } from "../src/errors.js";
import type { IntegrationProvider } from "../src/providers/contract.js";
import { IntegrationProviderRegistry } from "../src/providers/registry.js";
import { IntegrationRepository } from "../src/repository.js";
import { MemoryKeyProvider } from "../src/secrets/key-provider.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import {
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialsInput,
} from "../src/service-credentials/config.js";
import { ServiceCredentialRegistry } from "../src/service-credentials/registry.js";
import { operationCapabilityServiceState } from "../src/service-credentials/state.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialHealth,
} from "../src/service-credentials/types.js";
export function fakeLogger(): PluginLogger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
    close: async () => undefined,
  };
  return logger as unknown as PluginLogger;
}

/* ------------------------------------------------------------------ */
/* A made-up provider, so the core is tested as the generic boundary   */
/* ------------------------------------------------------------------ */

export const READ: OperationSecurityMetadata = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
};
export const SENSITIVE: OperationSecurityMetadata = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
};
export const WRITE: OperationSecurityMetadata = {
  effect: "write",
  sensitivity: "normal",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
};

export const OPERATIONS: Readonly<
  Record<
    string,
    {
      readonly capability: string;
      readonly security: OperationSecurityMetadata;
    }
  >
> = Object.freeze({
  "connection.get": {
    capability: "identity.read",
    security: { ...READ, requiresResourceBoundary: false },
  },
  "records.list": { capability: "records.read", security: READ },
  "records.get": { capability: "records.read", security: READ },
  "logs.get": { capability: "logs.read", security: SENSITIVE },
  "records.write": { capability: "records.write", security: WRITE },
  "records.unclassified": {
    capability: "records.read",
    // Deliberately absent from the provider's metadata table below.
    security: undefined as unknown as OperationSecurityMetadata,
  },
});

/**
 * What the provider's credential probe answers next. The probe's verdict is
 * part of the contract: a rejected credential has to fail the validation.
 */
const health: ServiceCredentialHealth = { status: "healthy" };

export interface Seen {
  readonly credential: string;
  readonly credentialSource: string | undefined;
  readonly boundary: unknown;
}

export function fakeProvider(options: {
  readonly capabilities: readonly string[];
  readonly seen: Seen[];
}): IntegrationProvider {
  return {
    id: "acme",
    displayName: "Acme",
    capabilities: options.capabilities,
    capabilityInfo: Object.fromEntries(
      options.capabilities.map((capability) => [
        capability,
        { label: capability, hint: `${capability} hint` },
      ]),
    ),
    credentialHelp: null,
    operationCapability: (operation) => OPERATIONS[operation]?.capability,
    operationMetadata: (operation) =>
      operation === "records.unclassified"
        ? undefined
        : OPERATIONS[operation]?.security,
    resourceBoundaryKind: (operation) =>
      OPERATIONS[operation]?.security?.requiresResourceBoundary === true
        ? "projects"
        : undefined,
    // One instance, so an empty id means it — the rule the real providers
    // apply for a deployment that has nothing to choose between.
    instancePortal: (instanceId) =>
      instanceId === "acme-app" || instanceId === ""
        ? "acme.example"
        : undefined,
    capabilityServiceState: (capability) =>
      operationCapabilityServiceState(
        Object.fromEntries(
          Object.entries(OPERATIONS).filter(
            ([operation]) => operation !== "records.unclassified",
          ),
        ),
        capability,
      ),
    parseCredential: (raw, opts) => ({
      credential: JSON.stringify({
        instanceId: opts?.["instanceId"] ?? "",
        token: raw.trim(),
      }),
      portal: "acme.example",
    }),
    validateServiceCredential: async ({ credential }) => ({
      ...health,
      upstreamIdentity: {
        id: "900",
        label: credential.includes("service-token") ? "Acme Service" : "Acme",
      },
    }),
    validate: async ({ credential }) => {
      if (credential.includes("expired")) {
        throw new IntegrationError(
          "CredentialExpired",
          "Acme token has expired",
        );
      }
      return {
        tenantId: "acme.example",
        externalUserId: "11",
        displayName: "Personal Acme",
        capabilities: options.capabilities,
      };
    },
    execute: async (context, operation, input) => {
      options.seen.push({
        credential: context.credential,
        credentialSource: context.credentialSource,
        boundary: context.resourceBoundary,
      });
      if (
        context.credentialSource === "service" &&
        operation !== "connection.get"
      ) {
        const projects = context.resourceBoundary?.["projects"] ?? [];
        const named = input["project"];
        if (named === undefined || !projects.includes(String(named))) {
          throw new IntegrationError(
            "ServiceResourceNotAllowed",
            "outside the boundary",
          );
        }
      }
      if (operation === "records.get" && input["project"] === "forbidden") {
        throw new IntegrationError(
          "ProviderPermissionDenied",
          "upstream refused",
        );
      }
      return { operation, named: input["project"] ?? null };
    },
  };
}

/* ------------------------------------------------------------------ */

export const repositories: IntegrationRepository[] = [];

/**
 * One master key for every store this suite builds: two harnesses have to be
 * able to serve the same database, which is what an upgrade looks like.
 */
export const HARNESS_KEY = randomBytes(32);

export interface Harness {
  readonly broker: IntegrationBroker;
  readonly registry: ServiceCredentialRegistry;
  readonly seen: Seen[];
}

export function buildHarness(
  filePath: string,
  input: ManagedServiceCredentialsInput,
  options: {
    readonly secret?: string;
    readonly capabilities?: readonly string[];
  } = {},
): Harness {
  const providers = new IntegrationProviderRegistry();
  const seen: Seen[] = [];
  providers.register(
    fakeProvider({
      capabilities: options.capabilities ?? [
        "identity.read",
        "records.read",
        "logs.read",
        "records.write",
      ],
      seen,
    }),
  );
  const repository = new IntegrationRepository(filePath);
  repositories.push(repository);
  const registry = new ServiceCredentialRegistry(
    resolveManagedServiceCredentials(input),
    (provider, instance) =>
      provider === "acme" && instance === "acme-app"
        ? "acme.example"
        : undefined,
    { env: { ACME_SERVICE_TOKEN: options.secret ?? "service-token-value" } },
  );
  return {
    broker: new IntegrationBroker(
      repository,
      new SecretStore(new MemoryKeyProvider(new Map([[1, HARNESS_KEY]]), 1)),
      providers,
      fakeLogger(),
      { serviceCredentials: registry, defaultForNewConnections: true },
    ),
    registry,
    seen,
  };
}

export const ACME_PROFILE = {
  id: "acme-readonly",
  provider: "acme",
  instance: "acme-app",
  label: "Acme Read-only",
  credential: { type: "pat", secretEnv: "ACME_SERVICE_TOKEN" },
  resources: { projects: ["alpha", "beta"] },
};

export const PROFILE_INPUT = (extra: Record<string, unknown> = {}) => ({
  enabled: true,
  defaultForNewConnections: true,
  profiles: [{ ...ACME_PROFILE, ...extra }],
});
