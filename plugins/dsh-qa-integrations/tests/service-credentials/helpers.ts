import { randomBytes } from "node:crypto";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationBroker } from "../../src/broker.js";
import { IntegrationError } from "../../src/errors.js";
import type { IntegrationProvider } from "../../src/providers/contract.js";
import { IntegrationProviderRegistry } from "../../src/providers/registry.js";
import { IntegrationRepository } from "../../src/repository.js";
import { MemoryKeyProvider } from "../../src/secrets/key-provider.js";
import { SecretStore } from "../../src/secrets/secret-store.js";
import {
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialsInput,
} from "../../src/service-credentials/config.js";
import { ServiceCredentialRegistry } from "../../src/service-credentials/registry.js";
import { ServiceRateLimiter } from "../../src/service-credentials/rate-limit.js";
import { operationCapabilityServiceState } from "../../src/service-credentials/state.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialHealth,
} from "../../src/service-credentials/types.js";
import type {
  EncryptedSecretRecord,
  IntegrationPrincipal,
  IntegrationProviderId,
  ProviderValidation,
} from "../../src/types.js";
/** A logger that keeps the warnings a suite wants to read back. */
export function fakeLogger(warns: string[] = []): PluginLogger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event: string) => {
      warns.push(event);
    },
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

/**
 * A credential probe a test decides when to finish. The probe still reaches
 * "upstream" and computes its answer — only the delivery of that answer is
 * parked — which is what makes the guard around a late write observable: the
 * verdict is the one the old credential produced, and it arrives after the
 * connection it was produced from has been replaced.
 */
export interface ProbeGate {
  /** The provider to register: `base` with a parkable credential probe. */
  readonly provider: IntegrationProvider;
  /** Resolves once a probe has been parked. */
  readonly entered: Promise<void>;
  /** Park the next probe, together with the answer it produced. */
  hold(): void;
  /** Stop parking, so a later call — the reconnect — runs straight through. */
  resume(): void;
  /** Hand the parked answer over. */
  release(): void;
}

export function gatedProbe(base: IntegrationProvider): ProbeGate {
  let holding = false;
  let markEntered: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let deliver: () => void = () => undefined;
  return {
    provider: {
      ...base,
      validate: async (context) => {
        const answer = await base.validate(context);
        if (!holding) return answer;
        const parked = new Promise<ProviderValidation>((resolve) => {
          deliver = () => resolve(answer);
        });
        markEntered();
        return await parked;
      },
    },
    entered,
    hold: () => {
      holding = true;
    },
    resume: () => {
      holding = false;
    },
    release: () => {
      deliver();
    },
  };
}

/* ------------------------------------------------------------------ */

export const repositories: IntegrationRepository[] = [];

/**
 * A store that records which credential each unlock was asked for: an operation
 * has to spend the secret its own binding names, and only the record identity
 * tells that apart from whatever the row happened to point at when it read.
 */
export class RecordingSecretStore extends SecretStore {
  public readonly unlocked: string[] = [];

  override async decrypt(record: EncryptedSecretRecord): Promise<string> {
    this.unlocked.push(record.id);
    return await super.decrypt(record);
  }
}

/**
 * A store that counts its own decrypt calls: a policy refusal has to land before
 * the credential is unlocked, and only a counter can tell that apart from a
 * refusal that unlocked the secret first and then changed its mind.
 */
export class CountingSecretStore extends SecretStore {
  public decryptCount = 0;

  override async decrypt(record: EncryptedSecretRecord): Promise<string> {
    this.decryptCount += 1;
    return await super.decrypt(record);
  }
}

/**
 * A store that loses the credential a binding names. This is what a reconnect
 * leaves behind for a read that started before it: the binding still points at a
 * secret that no longer exists. Nothing in the broker's own flow can be
 * interleaved between the capture and the unlock, so the state comes from here.
 */
export class VanishingSecretRepository extends IntegrationRepository {
  public secretGone = false;

  override secretByRef(
    principal: IntegrationPrincipal,
    provider: IntegrationProviderId,
    secretRef: string | null,
  ): EncryptedSecretRecord | undefined {
    return this.secretGone
      ? undefined
      : super.secretByRef(principal, provider, secretRef);
  }
}

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
    /** Clock of the request ceiling; a suite that counts minutes supplies one. */
    readonly now?: () => number;
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
  const managed = resolveManagedServiceCredentials(input);
  const registry = new ServiceCredentialRegistry(
    managed,
    (provider, instance) => {
      if (provider !== "acme") return undefined;
      // A second instance exists so one suite can publish two profiles of one
      // provider, the shape automatic binding refuses to guess over.
      if (instance === "acme-app") return "acme.example";
      if (instance === "acme-alt") return "acme-alt.example";
      return undefined;
    },
    { env: { ACME_SERVICE_TOKEN: options.secret ?? "service-token-value" } },
  );
  const rateLimits = new ServiceRateLimiter(managed.rateLimit, options.now);
  return {
    broker: new IntegrationBroker(
      repository,
      new SecretStore(new MemoryKeyProvider(new Map([[1, HARNESS_KEY]]), 1)),
      providers,
      fakeLogger(),
      {
        serviceCredentials: registry,
        // The deployment's own choice, the way the plugin hands it over: a
        // suite that leaves `defaultForNewConnections` out keeps the resolved
        // default rather than inheriting a literal from this helper.
        defaultForNewConnections: managed.defaultForNewConnections,
        rateLimits,
      },
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
