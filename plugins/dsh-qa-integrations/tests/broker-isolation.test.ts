import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationBroker } from "../src/broker.js";
import type { IntegrationProvider } from "../src/providers/contract.js";
import { IntegrationProviderRegistry } from "../src/providers/registry.js";
import { IntegrationRepository } from "../src/repository.js";
import { MemoryKeyProvider } from "../src/secrets/key-provider.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import type { IntegrationCapability } from "../src/types.js";

const OPERATION_CAPABILITY: Readonly<Record<string, IntegrationCapability>> = {
  "crm.get": "crm.read",
  "chat.messages": "chat.read",
  "tasks.list": "tasks.read",
};

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

/**
 * A made-up provider, so these tests exercise the broker as the generic
 * boundary it is: if this suite ever needed a real integration to pass, the
 * abstraction would be gone.
 */
function fakeProvider(options: {
  readonly capabilities: readonly IntegrationCapability[];
  readonly validated?: () => readonly IntegrationCapability[];
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
    execute: async ({ credential }, operation) => ({
      account: credential.includes("alice") ? "alice" : "bob",
      operation,
    }),
  };
}

/** Every repository a test built, so the handles are released on cleanup. */
const repositories: IntegrationRepository[] = [];

function buildBroker(
  filePath: string,
  provider: IntegrationProvider,
): IntegrationBroker {
  const providers = new IntegrationProviderRegistry();
  providers.register(provider);
  const repository = new IntegrationRepository(filePath);
  repositories.push(repository);
  return new IntegrationBroker(
    repository,
    new SecretStore(new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1)),
    providers,
    fakeLogger(),
  );
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
});
