import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
import {
  evaluateServiceOperation,
  narrowBoundary,
} from "../src/service-credentials/policy.js";
import { ServiceCredentialRegistry } from "../src/service-credentials/registry.js";
import { operationCapabilityServiceState } from "../src/service-credentials/state.js";
import type {
  OperationSecurityMetadata,
  ServiceCredentialHealth,
  ServiceCredentialProfile,
} from "../src/service-credentials/types.js";
import type { CapabilityServiceState } from "../src/types.js";

function fakeLogger(): PluginLogger {
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

const READ: OperationSecurityMetadata = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
  requiresResourceBoundary: true,
};
const SENSITIVE: OperationSecurityMetadata = {
  effect: "read",
  sensitivity: "sensitive",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
};
const WRITE: OperationSecurityMetadata = {
  effect: "write",
  sensitivity: "normal",
  serviceCredential: "deny",
  requiresResourceBoundary: true,
};

const OPERATIONS: Readonly<
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
let health: ServiceCredentialHealth = { status: "healthy" };

interface Seen {
  readonly credential: string;
  readonly credentialSource: string | undefined;
  readonly boundary: unknown;
}

function fakeProvider(options: {
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

const repositories: IntegrationRepository[] = [];

/**
 * One master key for every store this suite builds: two harnesses have to be
 * able to serve the same database, which is what an upgrade looks like.
 */
const HARNESS_KEY = randomBytes(32);

interface Harness {
  readonly broker: IntegrationBroker;
  readonly registry: ServiceCredentialRegistry;
  readonly seen: Seen[];
}

function buildHarness(
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

const ACME_PROFILE = {
  id: "acme-readonly",
  provider: "acme",
  instance: "acme-app",
  label: "Acme Read-only",
  credential: { type: "pat", secretEnv: "ACME_SERVICE_TOKEN" },
  resources: { projects: ["alpha", "beta"] },
};

const PROFILE_INPUT = (extra: Record<string, unknown> = {}) => ({
  enabled: true,
  defaultForNewConnections: true,
  profiles: [{ ...ACME_PROFILE, ...extra }],
});

describe("managed service credentials: configuration", () => {
  it("refuses a profile without a resource boundary", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: PROFILE_INPUT({ resources: {} }).profiles,
      }),
    ).toThrow(/resource boundary/u);
  });

  it("refuses an administrator policy that tries to widen the ceiling", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: PROFILE_INPUT({ policy: { "records.write": "allow" } })
          .profiles,
      }),
    ).toThrow(/can only be narrowed/u);
  });

  it("refuses a profile that names both a secret file and an environment variable", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: [
          {
            ...PROFILE_INPUT().profiles[0],
            credential: {
              secretFile: "/run/secrets/x",
              secretEnv: "ACME_SERVICE_TOKEN",
            },
          },
        ],
      }),
    ).toThrow(/not both/u);
  });

  it("refuses duplicate profile ids and duplicate instances", () => {
    expect(() =>
      resolveManagedServiceCredentials({
        profiles: [ACME_PROFILE, ACME_PROFILE],
      }),
    ).toThrow(/duplicate/u);
  });

  it("names the profile when its instance is unknown to the deployment", () => {
    expect(
      () =>
        new ServiceCredentialRegistry(
          resolveManagedServiceCredentials({
            profiles: [{ ...PROFILE_INPUT().profiles[0], instance: "typo" }],
          }),
          () => undefined,
        ),
    ).toThrow(/acme-readonly names unknown acme instance/u);
  });
});

describe("managed service credentials: policy", () => {
  const profile = Object.freeze({
    id: "p",
    provider: "acme",
    instance: "acme-app",
    portal: "acme.example",
    label: "Acme Read-only",
    authType: "pat",
    secretRef: "env:ACME_SERVICE_TOKEN",
    enabled: true,
    resources: Object.freeze({ projects: Object.freeze(["alpha"]) }),
    policy: Object.freeze({}),
    policyRevision: "rev1",
  }) satisfies ServiceCredentialProfile;

  it("allows a read of normal sensitivity that declared itself service-safe", () => {
    expect(
      evaluateServiceOperation({
        metadata: READ,
        capability: "records.read",
        profile,
        boundaryKind: "projects",
      }),
    ).toEqual({ allowed: true });
  });

  it("refuses a write even when the operation is of normal sensitivity", () => {
    const decision = evaluateServiceOperation({
      metadata: WRITE,
      capability: "records.write",
      profile,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "OperationNotAllowedWithServiceCredential",
    });
  });

  it("refuses a sensitive read with the personal-credential reason", () => {
    const decision = evaluateServiceOperation({
      metadata: SENSITIVE,
      capability: "logs.read",
      profile,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "SensitiveReadRequiresPersonalCredential",
    });
  });

  it("refuses an operation the provider did not classify", () => {
    const decision = evaluateServiceOperation({
      metadata: {
        effect: "admin",
        sensitivity: "secret",
        serviceCredential: "deny",
        requiresResourceBoundary: true,
      },
      capability: "records.read",
      profile,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({ allowed: false });
  });

  it("refuses a bounded operation whose provider names no boundary kind", () => {
    const decision = evaluateServiceOperation({
      metadata: READ,
      capability: "records.read",
      profile,
      boundaryKind: undefined,
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "ServiceResourceNotAllowed",
    });
  });

  it("reads a malformed selection as no narrowing at all", () => {
    const narrowed = narrowBoundary(profile.resources, {
      projects: "alpha" as unknown as readonly string[],
    });
    expect(narrowed).toEqual(profile.resources);
  });

  it("lets the administrator narrow a capability the provider allowed", () => {
    const narrowed = {
      ...profile,
      policy: { "records.read": "deny" as const },
    };
    const decision = evaluateServiceOperation({
      metadata: READ,
      capability: "records.read",
      profile: narrowed,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({ allowed: false });
  });
});

describe("managed service credentials: broker", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-service-"));
  afterAll(() => {
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("starts a new connection on the managed credential", async () => {
    const { broker } = buildHarness(
      path.join(root, "default.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    const summary = await broker.connect(alice, "acme", { token: "" });
    expect(summary.credentialSource).toBe("service");
    expect(summary.externalAccountName).toBe("Acme Read-only");
    expect(summary.credentialConfigured).toBe(false);
    // A sensitive capability is not granted at all in service mode.
    expect(summary.capabilities).toEqual(["identity.read", "records.read"]);
    expect(summary.service).toMatchObject({
      available: true,
      label: "Acme Read-only",
      resources: { projects: ["alpha", "beta"] },
    });
  });

  it("keeps an existing connection on its own credential after an upgrade", async () => {
    const file = path.join(root, "upgrade.db");
    const before = buildHarness(file, { enabled: true, profiles: [] });
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };
    for (const principal of [alice, bob]) {
      await before.broker.connect(principal, "acme", {
        token: `https://acme.example/rest/1/token-${principal.userId}`,
      });
    }
    expect(before.broker.summary(alice, "acme").credentialSource).toBe(
      "personal",
    );
    await before.broker.call(alice, {
      provider: "acme",
      operation: "records.get",
      input: { project: "gamma" },
      sourceSessionId: "s1",
    });

    // The same store, now served by a deployment that publishes a managed
    // credential. The rows that already exist keep the source they stored: an
    // upgrade never moves a user onto the shared account on its own.
    const after = buildHarness(file, PROFILE_INPUT());
    expect(after.broker.summary(alice, "acme").credentialSource).toBe(
      "personal",
    );
    await after.broker.call(alice, {
      provider: "acme",
      operation: "records.get",
      input: { project: "gamma" },
      sourceSessionId: "s1",
    });
    const call = after.seen.at(-1);
    expect(call?.credentialSource).toBe("personal");
    expect(call?.credential).toContain("token-alice");

    // A connection made after the upgrade does start on it.
    await after.broker.disconnect(bob, "acme");
    const connected = await after.broker.connect(bob, "acme", { token: "" });
    expect(connected.credentialSource).toBe("service");
  });

  it("refuses a write, a sensitive read and an unclassified operation in service mode", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "ceiling.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });

    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.write",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({
      code: "OperationNotAllowedWithServiceCredential",
    });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "logs.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.unclassified",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({
      code: "OperationNotAllowedWithServiceCredential",
    });
    // Nothing reached the provider: the ceiling is checked before the call.
    expect(seen).toEqual([]);
  });

  it("holds a service call inside the administrator boundary", async () => {
    const { broker } = buildHarness(
      path.join(root, "boundary.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "gamma" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // A refusal the provider reached is still a policy decision, not a failure:
    // the trail has to read as one.
    expect(repositories.at(-1)?.read().audit.at(-1)).toMatchObject({
      result: "denied",
      credentialSource: "service",
    });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).resolves.toMatchObject({ data: { named: "alpha" } });
  });

  it("lets a user narrow the boundary but never widen it", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "narrow.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    const summary = broker.setServiceSelection(alice, "acme", {
      projects: ["gamma", "alpha"],
    });
    // gamma was never in the administrator's list, so it is dropped rather
    // than stored.
    expect(summary.service?.selection).toEqual({ projects: ["alpha"] });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "beta" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).resolves.toMatchObject({ data: { named: "alpha" } });
    expect(seen.at(-1)?.boundary).toEqual({ projects: ["alpha"] });
  });

  it("tells the caller when the requested credential does not exist", async () => {
    const { broker } = buildHarness(path.join(root, "absent.db"), {
      enabled: true,
      profiles: [],
    });
    const alice = { userId: "alice" };
    await expect(
      broker.connect(
        alice,
        "acme",
        { token: "" },
        { useServiceCredential: true },
      ),
    ).rejects.toMatchObject({ code: "ServiceCredentialUnavailable" });
  });

  it("keeps two users on one service credential with independent boundaries", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "users.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };
    await broker.connect(alice, "acme", { token: "" });
    await broker.connect(bob, "acme", { token: "" });
    broker.setServiceSelection(bob, "acme", { projects: ["beta"] });

    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "beta" },
        sourceSessionId: "s-alice",
      }),
    ).resolves.toMatchObject({ data: { named: "beta" } });
    await expect(
      broker.call(bob, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s-bob",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // Both calls spent the deployment's token, and neither was billed to the
    // other's binding.
    expect(
      seen.every((call) => call.credential.includes("service-token")),
    ).toBe(true);
  });

  it("audits the real principal and the credential source of every service call", async () => {
    const file = path.join(root, "audit.db");
    const { broker } = buildHarness(file, PROFILE_INPUT());
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "logs.get",
        input: { project: "alpha" },
        sourceSessionId: "s-alice",
      }),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    await broker.call(alice, {
      provider: "acme",
      operation: "records.get",
      input: { project: "alpha" },
      sourceSessionId: "s-alice",
    });
    const repository = repositories.at(-1);
    const audit = repository?.read().audit ?? [];
    const denied = audit.find((entry) => entry.operation === "logs.get");
    const allowed = audit.find((entry) => entry.operation === "records.get");
    expect(denied).toMatchObject({
      ownerUserId: "alice",
      credentialSource: "service",
      serviceProfileId: "acme-readonly",
      result: "denied",
    });
    expect(allowed).toMatchObject({
      ownerUserId: "alice",
      credentialSource: "service",
      serviceProfileId: "acme-readonly",
      sourceSessionId: "s-alice",
      result: "success",
    });
  });

  it("never falls back to the other credential after a refusal", async () => {
    const { broker, seen } = buildHarness(
      path.join(root, "switch.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };

    // Personal mode first: upstream refuses one read, and that refusal is the
    // answer. It is not a reason to try the deployment's account.
    const personal = await broker.connect(
      alice,
      "acme",
      { token: "https://acme.example/rest/1/personal-token" },
      { useServiceCredential: false },
    );
    expect(personal.credentialSource).toBe("personal");
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "forbidden" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(seen.every((call) => call.credentialSource === "personal")).toBe(
      true,
    );

    // The other direction: the service boundary refuses, and the personal
    // credential that is still stored does not step in.
    const service = await broker.setCredentialSource(alice, "acme", "service");
    expect(service.credentialSource).toBe("service");
    expect(service.credentialConfigured).toBe(true);
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "forbidden" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(seen.at(-1)?.credentialSource).toBe("service");
  });

  it("increments the binding revision on every credential-mode switch", async () => {
    const file = path.join(root, "revision.db");
    const { broker } = buildHarness(file, PROFILE_INPUT());
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await broker.connect(
      alice,
      "acme",
      { token: "https://acme.example/rest/1/personal-token" },
      { useServiceCredential: false },
    );
    await broker.setCredentialSource(alice, "acme", "service");
    const repository = repositories.at(-1);
    expect(repository?.find(alice, "acme")?.bindingRevision).toBe(3);
  });

  it("repairs a capability a provider has since split, policy included", () => {
    const file = path.join(root, "repair.db");
    const repository = new IntegrationRepository(file);
    repositories.push(repository);
    const principal = { userId: "alice" };
    const encrypted = {
      id: "secret-1",
      ciphertext: "x",
      nonce: "x",
      authTag: "x",
      wrappedDek: "x",
      wrapNonce: "x",
      wrapAuthTag: "x",
      keyVersion: 1,
      secretType: "token" as const,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repository.connect({
      principal,
      provider: "acme",
      secret: encrypted,
      tenantId: "acme.example",
      externalUserId: "11",
      displayName: "Personal Acme",
      capabilities: ["identity.read", "ci.read"],
    });
    repository.setPolicy(principal, "acme", "ci.read", "deny");

    repository.expandCapabilities({
      "ci.read": ["ci.metadata.read", "ci.logs.read"],
    });

    const integration = repository.find(principal, "acme");
    expect(integration?.capabilities).toEqual([
      "identity.read",
      "ci.metadata.read",
      "ci.logs.read",
    ]);
    // The policy the operator had set travels with the split, so a capability
    // that was off does not come back on.
    const policies = repositories.at(-1)?.read().policies ?? {};
    const id = integration?.id ?? "";
    expect(policies[`${id}:ci.metadata.read`]).toBe("deny");
    expect(policies[`${id}:ci.logs.read`]).toBe("deny");
    expect(policies[`${id}:ci.read`]).toBeUndefined();

    // Running it again changes nothing.
    const before = repository.read().integrations[0]?.capabilities;
    repository.expandCapabilities({
      "ci.read": ["ci.metadata.read", "ci.logs.read"],
    });
    expect(repository.read().integrations[0]?.capabilities).toEqual(before);
  });

  it("records what the probe found and refuses a credential it rejects", async () => {
    const file = path.join(root, "health.db");
    const { broker } = buildHarness(file, PROFILE_INPUT());
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    const repository = repositories.at(-1);

    // A token upstream rejects is not a successful validation.
    health = { status: "revoked" };
    await expect(broker.validate(alice, "acme")).rejects.toMatchObject({
      code: "CredentialRevoked",
    });
    expect(broker.summary(alice, "acme").status).toBe("error");
    expect(broker.summary(alice, "acme").errorCode).toBe("CredentialRevoked");
    expect(repository?.read().audit.at(-1)).toMatchObject({
      operation: "credential.validate",
      result: "error",
      credentialSource: "service",
    });

    // A wider-than-read-only token is reported, not refused: the ceiling still
    // bounds the connection, and the operator needs to know.
    health = {
      status: "unsafe_scope",
      warnings: ["wider than read-only"],
    };
    const summary = await broker.validate(alice, "acme");
    expect(summary.status).toBe("connected");
    expect(summary.errorCode).toBe("ServiceCredentialUnsafeScope");

    health = { status: "healthy" };
    expect((await broker.validate(alice, "acme")).errorCode).toBeNull();
  });

  it("refuses to switch to a personal credential that was never stored", async () => {
    const { broker } = buildHarness(
      path.join(root, "nopersonal.db"),
      PROFILE_INPUT(),
    );
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    await expect(
      broker.setCredentialSource(alice, "acme", "personal"),
    ).rejects.toMatchObject({ code: "PersonalCredentialRequired" });
  });

  it("blocks calls the moment the deployment disables the profile", async () => {
    const file = path.join(root, "disabled.db");
    const { broker, registry } = buildHarness(file, PROFILE_INPUT());
    const alice = { userId: "alice" };
    await broker.connect(alice, "acme", { token: "" });
    const [profile] = registry.list();
    // The deployment retires the credential: the binding it already has must
    // stop working immediately rather than at the next reconnect.
    const disabled = new ServiceCredentialRegistry(
      resolveManagedServiceCredentials({
        ...PROFILE_INPUT(),
        profiles: [{ ...PROFILE_INPUT().profiles[0], enabled: false }],
      }),
      (provider, instance) =>
        provider === "acme" && instance === "acme-app"
          ? "acme.example"
          : undefined,
      { env: { ACME_SERVICE_TOKEN: "service-token-value" } },
    );
    const providers = new IntegrationProviderRegistry();
    providers.register(fakeProvider({ capabilities: [], seen: [] }));
    const repository = repositories.at(-1);
    expect(repository).toBeDefined();
    const blocked = new IntegrationBroker(
      repository as IntegrationRepository,
      new SecretStore(new MemoryKeyProvider(new Map([[1, HARNESS_KEY]]), 1)),
      providers,
      fakeLogger(),
      { serviceCredentials: disabled, defaultForNewConnections: true },
    );
    expect(profile?.enabled).toBe(true);
    expect(disabled.list()[0]?.enabled).toBe(false);
    await expect(
      blocked.call(alice, {
        provider: "acme",
        operation: "records.get",
        input: { project: "alpha" },
        sourceSessionId: "s1",
      }),
    ).rejects.toMatchObject({ code: "ServiceCredentialDisabled" });
    const denied = repository?.read().audit.at(-1);
    expect(denied).toMatchObject({
      ownerUserId: "alice",
      operation: "records.get",
      result: "denied",
      credentialSource: "service",
      serviceProfileId: "acme-readonly",
    });
  });

  it("serves a call with a rotated secret without anyone reconnecting", async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), "qa-integrations-rot-"));
    const secretPath = path.join(root2, "service-token");
    writeFileSync(secretPath, "first-token-value\n");
    const registry = new ServiceCredentialRegistry(
      resolveManagedServiceCredentials({
        profiles: [
          {
            ...ACME_PROFILE,
            credential: { type: "pat", secretFile: secretPath },
          },
        ],
      }),
      () => "acme.example",
    );
    const [profile] = registry.list();
    expect(profile).toBeDefined();
    const first = registry.readSecret(profile as ServiceCredentialProfile);
    expect(first.secret).toBe("first-token-value");

    writeFileSync(secretPath, "second-token-value\n");
    const future = new Date(Date.now() + 5_000);
    utimesSync(secretPath, future, future);
    const second = registry.readSecret(profile as ServiceCredentialProfile);
    expect(second.secret).toBe("second-token-value");
    // Rotation changes the revision, which is what invalidates anything derived
    // from the previous credential.
    expect(second.credentialRevision).not.toBe(first.credentialRevision);
    rmSync(root2, { recursive: true, force: true });
  });

  it("refuses to serve a profile whose secret is missing", () => {
    const registry = new ServiceCredentialRegistry(
      resolveManagedServiceCredentials({
        profiles: [
          {
            ...ACME_PROFILE,
            credential: { type: "pat", secretFile: "/definitely/absent" },
          },
        ],
      }),
      () => "acme.example",
    );
    const [profile] = registry.list();
    expect(() =>
      registry.readSecret(profile as ServiceCredentialProfile),
    ).toThrow(/not available/u);
  });

  it("reports an instance as unmanaged when the deployment configures nothing", async () => {
    const { broker } = buildHarness(path.join(root, "unmanaged.db"), {
      enabled: false,
      profiles: [],
    });
    const alice = { userId: "alice" };
    const summary = await broker.connect(alice, "acme", {
      token: "https://acme.example/rest/1/personal-token",
    });
    expect(summary.credentialSource).toBe("personal");
    // The provider supports managed credentials, but this deployment configures
    // none, so nothing is offered and no mode can be chosen.
    expect(summary.service).toMatchObject({ available: false, label: null });
  });

  it("wraps an unusable managed secret instead of spending it", () => {
    const { registry } = buildHarness(
      path.join(root, "invalid.db"),
      {
        enabled: true,
        profiles: [{ ...ACME_PROFILE, resources: { projects: ["alpha"] } }],
      },
      { secret: "   " },
    );
    const [profile] = registry.list();
    expect(profile).toBeDefined();
    expect(() =>
      registry.readSecret(profile as ServiceCredentialProfile),
    ).toThrow(/not available/u);
  });
});

describe("managed service credentials: capability state", () => {
  it("is available, sensitive or unavailable per capability", () => {
    const table = Object.fromEntries(
      Object.entries(OPERATIONS).filter(
        ([operation]) => operation !== "records.unclassified",
      ),
    );
    expect(operationCapabilityServiceState(table, "records.read")).toBe(
      "available" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "logs.read")).toBe(
      "sensitive" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "records.write")).toBe(
      "unavailable" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "identity.read")).toBe(
      "available" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "nothing.read")).toBe(
      "unavailable" satisfies CapabilityServiceState,
    );
  });
});
