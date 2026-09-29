import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IntegrationBroker } from "../../src/broker.js";
import type { IntegrationProvider } from "../../src/providers/contract.js";
import { IntegrationProviderRegistry } from "../../src/providers/registry.js";
import { IntegrationRepository } from "../../src/repository.js";
import { MemoryKeyProvider } from "../../src/secrets/key-provider.js";
import { SecretStore } from "../../src/secrets/secret-store.js";
import { DEFAULT_SERVICE_RATE_LIMIT } from "../../src/service-credentials/config.js";
import type { IntegrationCapability } from "../../src/types.js";
import {
  CountingSecretStore,
  RecordingSecretStore,
  VanishingSecretRepository,
  fakeLogger,
  gatedProbe,
  repositories,
} from "./helpers.js";

const OPERATION_CAPABILITY: Readonly<Record<string, IntegrationCapability>> = {
  "crm.get": "crm.read",
  "chat.messages": "chat.read",
  "tasks.list": "tasks.read",
};

/**
 * A made-up provider, so these tests exercise the broker as the generic
 * boundary it is: if this suite ever needed a real integration to pass, the
 * abstraction would be gone.
 */
function fakeProvider(options: {
  readonly capabilities: readonly IntegrationCapability[];
  readonly validated?: () => readonly IntegrationCapability[];
  /** Records every read that actually reached "upstream". */
  readonly executed?: () => void;
  /**
   * What the provider's catalog names, which on a real integration is wider
   * than what the deployment lets it offer: a capability the configuration has
   * withdrawn stays a row of the card, drawn from here, and only stops being a
   * grant. Defaults to the offered set, the way a deployment that never
   * narrowed anything looks.
   */
  readonly catalog?: readonly IntegrationCapability[];
}): IntegrationProvider {
  return {
    id: "acme",
    displayName: "Acme",
    capabilities: options.capabilities,
    capabilityInfo: Object.fromEntries(
      (options.catalog ?? options.capabilities).map((capability) => [
        capability,
        { label: capability, hint: `${capability} hint` },
      ]),
    ),
    credentialHelp: {
      kind: "api-key",
      label: "Acme API key",
      obtain: { url: "https://acme.example.com/keys" },
      scopes: ["crm.read"],
    },
    credentialHelpProblems: [],
    operationCapability: (operation) => OPERATION_CAPABILITY[operation],
    parseCredential: (raw) => ({
      credential: JSON.stringify({ webhookBaseUrl: raw }),
      portal: new URL(raw).hostname,
    }),
    validate: async ({ credential }) => {
      const base = String(
        (JSON.parse(credential) as { webhookBaseUrl: string }).webhookBaseUrl,
      );
      return {
        tenantId: new URL(base).hostname,
        externalUserId: base.includes("alice") ? "11" : "22",
        displayName: base.includes("alice") ? "Alice" : "Bob",
        capabilities: options.validated?.() ?? options.capabilities,
      };
    },
    execute: async ({ credential }, operation) => {
      options.executed?.();
      return {
        account: credential.includes("alice") ? "alice" : "bob",
        operation,
      };
    },
  };
}

function buildBroker(
  filePath: string,
  provider: IntegrationProvider,
  warns: string[] = [],
  secrets?: SecretStore,
): IntegrationBroker {
  const providers = new IntegrationProviderRegistry();
  providers.register(provider);
  const repository = new IntegrationRepository(filePath);
  repositories.push(repository);
  return new IntegrationBroker(
    repository,
    secrets ??
      new SecretStore(
        new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
      ),
    providers,
    fakeLogger(warns),
  );
}

/** Registry of one provider, as a reloaded configuration would hand it over. */
function registryOf(
  ...providers: readonly IntegrationProvider[]
): IntegrationProviderRegistry {
  const registry = new IntegrationProviderRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}

describe("IntegrationBroker user isolation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-test-"));
  const filePath = path.join(root, "integrations.db");
  // The store is a database now, so its handle has to be released before the
  // directory goes: on Windows an open file cannot be deleted.
  afterAll(() => {
    for (const repository of repositories) repository.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps Alice and Bob credentials separate under concurrent tool calls", async () => {
    const broker = buildBroker(
      filePath,
      fakeProvider({ capabilities: ["crm.read", "chat.read"] }),
    );
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };
    const aliceSecret = "alice-secret-123";
    const bobSecret = "bob-secret-456";
    await broker.connect(alice, "acme", {
      token: `https://alice.example/rest/1/${aliceSecret}`,
    });
    await broker.connect(bob, "acme", {
      token: `https://bob.example/rest/2/${bobSecret}`,
    });

    const [aliceResult, bobResult] = await Promise.all([
      broker.call(alice, {
        provider: "acme",
        operation: "crm.get",
        input: { entityTypeId: 2, id: 1 },
        sourceSessionId: "session-alice",
      }),
      broker.call(bob, {
        provider: "acme",
        operation: "crm.get",
        input: { entityTypeId: 2, id: 1 },
        sourceSessionId: "session-bob",
      }),
    ]);
    expect(aliceResult.data).toMatchObject({ account: "alice" });
    expect(bobResult.data).toMatchObject({ account: "bob" });
    expect(broker.summary(alice, "acme").externalAccountName).toBe("Alice");
    expect(broker.summary(bob, "acme").externalAccountName).toBe("Bob");

    const persisted = readFileSync(filePath, "utf8");
    expect(persisted).not.toContain(aliceSecret);
    expect(persisted).not.toContain(bobSecret);
    expect(JSON.stringify(broker.summary(alice, "acme"))).not.toContain(
      "secretRef",
    );

    expect(broker.disconnect(alice, "acme")).toBe(true);
    await expect(
      broker.call(alice, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-alice",
      }),
    ).rejects.toMatchObject({ code: "IntegrationNotConnected" });
    await expect(
      broker.call(bob, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-bob",
      }),
    ).resolves.toMatchObject({ data: { account: "bob" } });
  });

  it("denies operations whose capability the webhook did not grant", async () => {
    const broker = buildBroker(
      path.join(root, "partial.json"),
      fakeProvider({ capabilities: ["crm.read"] }),
    );
    const principal = { userId: "carol" };
    const summary = await broker.connect(principal, "acme", {
      token: "https://carol.example/rest/3/carol-secret-value",
    });
    expect(summary.capabilities).toEqual(["crm.read"]);
    expect(
      summary.policy.find((entry) => entry.capability === "chat.read"),
    ).toBeUndefined();

    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "chat.messages",
        input: { dialogId: "chat1" },
        sourceSessionId: "session-carol",
      }),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-carol",
      }),
    ).resolves.toMatchObject({ data: { operation: "crm.get" } });
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "unknown.operation",
        input: {},
        sourceSessionId: "session-carol",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("re-probes capabilities on validate and leaves the new ones denied", async () => {
    let granted: readonly IntegrationCapability[] = ["crm.read"];
    const broker = buildBroker(
      path.join(root, "reprobe.json"),
      fakeProvider({
        capabilities: ["crm.read", "tasks.read"],
        validated: () => granted,
      }),
    );
    const principal = { userId: "dave" };
    await broker.connect(principal, "acme", {
      token: "https://dave.example/rest/4/dave-secret-value",
    });
    expect(broker.summary(principal, "acme").capabilities).toEqual([
      "crm.read",
    ]);

    granted = ["crm.read", "tasks.read"];
    const refreshed = await broker.validate(principal, "acme");
    expect(refreshed.capabilities).toEqual(["crm.read", "tasks.read"]);
    // Detected but not yet enabled by the user, so the agent still may not read tasks.
    expect(
      refreshed.policy.find((entry) => entry.capability === "tasks.read")?.mode,
    ).toBe("deny");
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "tasks.list",
        input: {},
        sourceSessionId: "session-dave",
      }),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });

    broker.patchPolicy(principal, "acme", {
      operation: "tasks.read",
      mode: "allow",
    });
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "tasks.list",
        input: {},
        sourceSessionId: "session-dave",
      }),
    ).resolves.toMatchObject({ data: { operation: "tasks.list" } });
  });

  it("refuses a capability the deployment withdrew after the connection", async () => {
    const executed: string[] = [];
    const secrets = new CountingSecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    const broker = buildBroker(
      path.join(root, "withdrawn.json"),
      fakeProvider({
        capabilities: ["crm.read"],
        executed: () => {
          executed.push("upstream");
        },
      }),
      [],
      secrets,
    );
    const principal = { userId: "erin" };
    await broker.connect(principal, "acme", {
      token: "https://erin.example/rest/5/erin-secret-value",
    });
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-erin",
      }),
    ).resolves.toMatchObject({ data: { operation: "crm.get" } });
    expect(executed).toEqual(["upstream"]);
    // The counter is live: serving this read did unlock the credential.
    expect(secrets.decryptCount).toBeGreaterThan(0);
    const decrypted = secrets.decryptCount;
    // The card lists the grant while the provider still offers it.
    expect(broker.summary(principal, "acme").capabilities).toEqual([
      "crm.read",
    ]);

    // The operator switches the capability off. The stored grant and its policy
    // are untouched — that is what a reconnect-free withdrawal leaves behind. The
    // provider's catalog keeps naming the capability, the way a deployment that
    // narrows what a provider may offer leaves the catalog itself alone.
    broker.swap(
      registryOf(
        fakeProvider({
          capabilities: [],
          catalog: ["crm.read"],
          executed: () => {
            executed.push("upstream");
          },
        }),
      ),
      undefined,
      true,
      DEFAULT_SERVICE_RATE_LIMIT,
    );

    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-erin",
      }),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
    expect(executed).toEqual(["upstream"]);
    // Denied on the deployment's own withdrawal, ahead of any decryption.
    expect(secrets.decryptCount).toBe(decrypted);
    // The card reads through the same intersection: nothing is granted and no
    // policy row is offered any more. The catalog row itself stays in the list
    // the operator reads, because that list is drawn from the provider and not
    // from this connection — what changes is that it carries no grant, so the
    // client renders it unavailable instead of offering a switch that only ever
    // answers a refusal.
    const shown = broker.summary(principal, "acme");
    expect(shown.capabilities).toEqual([]);
    expect(shown.policy).toEqual([]);
    expect(Object.keys(shown.capabilityInfo)).toEqual(["crm.read"]);
  });

  it("keeps a withdrawn capability from collecting a fresh allowance", async () => {
    const broker = buildBroker(
      path.join(root, "withdrawn-allowance.json"),
      fakeProvider({ capabilities: ["crm.read", "tasks.read"] }),
    );
    const principal = { userId: "ivan" };
    await broker.connect(principal, "acme", {
      token: "https://ivan.example/rest/11/ivan-token",
    });
    // Connecting allows everything the credential reported, so the switch the
    // user turns off here is one the withdrawal has to leave off.
    broker.patchPolicy(principal, "acme", {
      operation: "tasks.read",
      mode: "deny",
    });
    broker.swap(
      registryOf(fakeProvider({ capabilities: ["crm.read"] })),
      undefined,
      true,
      DEFAULT_SERVICE_RATE_LIMIT,
    );

    // A page opened before the withdrawal still shows the switch and posts what
    // it rendered. That capability is not part of this connection any more, so
    // no allowance may be written against it: a row set inside the window would
    // sit inert and then serve the moment the deployment gave the capability
    // back — a permission nobody asked for.
    expect(() =>
      broker.patchPolicy(principal, "acme", {
        operation: "tasks.read",
        mode: "allow",
      }),
    ).toThrowError(/Capability is unavailable/u);

    // The deployment gives the capability back. What serves now is what the user
    // left behind before the window, not what a stale page posted inside it.
    broker.swap(
      registryOf(fakeProvider({ capabilities: ["crm.read", "tasks.read"] })),
      undefined,
      true,
      DEFAULT_SERVICE_RATE_LIMIT,
    );
    expect(
      broker
        .summary(principal, "acme")
        .policy.find((entry) => entry.capability === "tasks.read")?.mode,
    ).toBe("deny");
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "tasks.list",
        input: {},
        sourceSessionId: "session-ivan",
      }),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
  });

  it("keeps a policy write from reaching a provider the configuration dropped", async () => {
    const broker = buildBroker(
      path.join(root, "dropped-provider.json"),
      fakeProvider({ capabilities: ["crm.read", "tasks.read"] }),
    );
    const principal = { userId: "kate" };
    await broker.connect(principal, "acme", {
      token: "https://kate.example/rest/14/kate-token",
    });
    broker.patchPolicy(principal, "acme", {
      operation: "tasks.read",
      mode: "deny",
    });

    // The provider has left the configuration; the connection it belongs to is
    // still stored. Reaching for the provider to decide an allowance is a
    // request this plugin cannot route, and the answer is the registry's own
    // refusal — not a row written against a provider nobody can ask anything.
    broker.swap(registryOf(), undefined, true, DEFAULT_SERVICE_RATE_LIMIT);
    expect(() =>
      broker.patchPolicy(principal, "acme", {
        operation: "tasks.read",
        mode: "allow",
      }),
    ).toThrowError(/provider is unavailable/u);

    // Nothing was stored: the switch stays where its owner left it, so the
    // provider coming back does not bring a permission with it.
    broker.swap(
      registryOf(fakeProvider({ capabilities: ["crm.read", "tasks.read"] })),
      undefined,
      true,
      DEFAULT_SERVICE_RATE_LIMIT,
    );
    expect(
      broker
        .summary(principal, "acme")
        .policy.find((entry) => entry.capability === "tasks.read")?.mode,
    ).toBe("deny");
  });

  it("files a credential the read lost to a reconnect as an error, not a refusal", async () => {
    const secrets = new CountingSecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    const repository = new VanishingSecretRepository(
      path.join(root, "vanished-credential.db"),
    );
    repositories.push(repository);
    const broker = new IntegrationBroker(
      repository,
      secrets,
      registryOf(fakeProvider({ capabilities: ["crm.read"] })),
      fakeLogger(),
    );
    const principal = { userId: "judy" };
    await broker.connect(principal, "acme", {
      token: "https://judy.example/rest/12/judy-token",
    });

    // The account is re-saved while this read is on its way, so the credential
    // the binding names has been spent and the unlock finds nothing at that
    // reference. Nobody declined this call — the connection moved under it — so
    // the trail has to say an operation failed, not that policy refused one,
    // and the user must not be told to store a token they just replaced.
    repository.secretGone = true;
    const decrypted = secrets.decryptCount;
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-judy",
      }),
    ).rejects.toMatchObject({ code: "IntegrationNotConnected" });
    expect(secrets.decryptCount).toBe(decrypted);
    expect(repository.read().audit.at(-1)).toMatchObject({
      ownerUserId: "judy",
      operation: "crm.get",
      result: "error",
    });

    // The other half of the classification is unchanged: a call the policy
    // declines is still filed as a refusal.
    broker.swap(
      registryOf(fakeProvider({ capabilities: [] })),
      undefined,
      true,
      DEFAULT_SERVICE_RATE_LIMIT,
    );
    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-judy",
      }),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
    expect(repository.read().audit.at(-1)).toMatchObject({
      operation: "crm.get",
      result: "denied",
    });
  });

  it("drops a validation verdict that lands after the account reconnected", async () => {
    const warns: string[] = [];
    let granted: readonly IntegrationCapability[] = ["crm.read"];
    const probe = gatedProbe(
      fakeProvider({
        capabilities: ["crm.read", "chat.read"],
        validated: () => granted,
      }),
    );
    const broker = buildBroker(
      path.join(root, "late-validation.json"),
      probe.provider,
      warns,
    );
    const principal = { userId: "faith" };
    await broker.connect(principal, "acme", {
      token: "https://alice.example/rest/6/faith-token-a",
    });
    expect(broker.summary(principal, "acme").externalAccountName).toBe("Alice");

    probe.hold();
    const pending = broker.validate(principal, "acme");
    await probe.entered;
    // A second token for the same provider, spent while that probe is open. The
    // verdict on its way answers for the first credential.
    probe.resume();
    granted = ["chat.read"];
    await broker.connect(principal, "acme", {
      token: "https://bob.example/rest/7/faith-token-b",
    });
    expect(broker.summary(principal, "acme").externalAccountName).toBe("Bob");

    probe.release();
    await pending;

    const after = broker.summary(principal, "acme");
    expect(after.externalAccountName).toBe("Bob");
    expect(after.capabilities).toEqual(["chat.read"]);
    expect(warns).toContain("credential.validation-stale");
  });

  it("keeps a verdict of a connection that was closed as its own diagnosis", async () => {
    const warns: string[] = [];
    const probe = gatedProbe(fakeProvider({ capabilities: ["crm.read"] }));
    const broker = buildBroker(
      path.join(root, "unbound-validation.json"),
      probe.provider,
      warns,
    );
    const principal = { userId: "zoe" };
    await broker.connect(principal, "acme", {
      token: "https://alice.example/rest/13/zoe-token",
    });

    probe.hold();
    const pending = broker.validate(principal, "acme");
    await probe.entered;
    probe.resume();
    // The account disconnected and nobody took the connection up again, so there
    // is no row whose generation this answer could disagree with. A person
    // reading the log has to be able to tell that race from a verdict that lost
    // to a newer generation of the same connection.
    broker.disconnect(principal, "acme");
    probe.release();
    await pending;

    expect(warns).toContain("credential.validation-unbound");
    expect(warns).not.toContain("credential.validation-stale");
  });

  it("stores a validation verdict whose binding is still the live one", async () => {
    const warns: string[] = [];
    let granted: readonly IntegrationCapability[] = ["crm.read"];
    const probe = gatedProbe(
      fakeProvider({
        capabilities: ["crm.read", "chat.read"],
        validated: () => granted,
      }),
    );
    const broker = buildBroker(
      path.join(root, "in-order-validation.json"),
      probe.provider,
      warns,
    );
    const principal = { userId: "gabe" };
    await broker.connect(principal, "acme", {
      token: "https://alice.example/rest/8/gabe-token-a",
    });
    expect(broker.summary(principal, "acme").capabilities).toEqual([
      "crm.read",
    ]);

    // The scope arrives upstream while nothing else moves the binding, and the
    // verdict lands on the generation it started from.
    granted = ["crm.read", "chat.read"];
    probe.hold();
    const pending = broker.validate(principal, "acme");
    await probe.entered;
    probe.release();
    const refreshed = await pending;

    expect(refreshed.capabilities).toEqual(["crm.read", "chat.read"]);
    expect(warns).not.toContain("credential.validation-stale");
    expect(warns).not.toContain("credential.validation-unbound");
  });

  it("unlocks the credential the binding it works from names", async () => {
    const secrets = new RecordingSecretStore(
      new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
    );
    const broker = buildBroker(
      path.join(root, "bound-credential.json"),
      fakeProvider({ capabilities: ["crm.read"] }),
      [],
      secrets,
    );
    const repository = repositories.at(-1)!;
    const principal = { userId: "heidi" };
    await broker.connect(principal, "acme", {
      token: "https://heidi.example/rest/9/heidi-token-a",
    });
    const first = repository.find(principal, "acme")!;

    await expect(
      broker.call(principal, {
        provider: "acme",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-heidi",
      }),
    ).resolves.toMatchObject({ data: { operation: "crm.get" } });
    await broker.validate(principal, "acme");
    // Both operations spent exactly the record this binding carries — the read
    // is addressed by the binding, so it cannot follow a reconnect that happens
    // while the operation is still on its way.
    expect(secrets.unlocked).toEqual([first.secretRef, first.secretRef]);

    await broker.connect(principal, "acme", {
      token: "https://bob.example/rest/10/heidi-token-b",
    });
    const second = repository.find(principal, "acme")!;
    expect(second.secretRef).not.toBe(first.secretRef);
    // The reference only counts while the live row carries it, so the generation
    // this read started from reaches nothing — neither the credential it replaced
    // nor the one that took its place.
    expect(repository.secretByRef(principal, "acme", first.secretRef)).toBe(
      undefined,
    );
    expect(
      repository.secretByRef(principal, "acme", second.secretRef)?.id,
    ).toBe(second.secretRef);

    await broker.call(principal, {
      provider: "acme",
      operation: "crm.get",
      input: {},
      sourceSessionId: "session-heidi",
    });
    expect(secrets.unlocked.at(-1)).toBe(second.secretRef);
  });
});
