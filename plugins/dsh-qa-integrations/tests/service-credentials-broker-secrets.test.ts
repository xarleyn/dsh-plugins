import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IntegrationBroker } from "../src/broker.js";
import { IntegrationError } from "../src/errors.js";
import { IntegrationRepository } from "../src/repository.js";
import type { IntegrationProvider } from "../src/providers/contract.js";
import { IntegrationProviderRegistry } from "../src/providers/registry.js";
import { MemoryKeyProvider } from "../src/secrets/key-provider.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import {
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialsInput,
} from "../src/service-credentials/config.js";
import { ServiceCredentialRegistry } from "../src/service-credentials/registry.js";
import { operationCapabilityServiceState } from "../src/service-credentials/state.js";
import type {
  ServiceCredentialHealth,
  ServiceCredentialProfile,
} from "../src/service-credentials/types.js";
import {
  ACME_PROFILE,
  HARNESS_KEY,
  OPERATIONS,
  PROFILE_INPUT,
  fakeLogger,
  repositories,
} from "./service-credentials.helpers.js";
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

describe("managed service credentials: broker", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-service-"));
  afterAll(() => {
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
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
