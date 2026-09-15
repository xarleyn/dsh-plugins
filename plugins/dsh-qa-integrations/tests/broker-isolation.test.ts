import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { IntegrationBroker } from "../src/broker.js";
import { resolveConfig } from "../src/config.js";
import type { IntegrationProvider } from "../src/providers/contract.js";
import { IntegrationProviderRegistry } from "../src/providers/registry.js";
import { IntegrationRepository } from "../src/repository.js";
import { MemoryKeyProvider } from "../src/secrets/key-provider.js";
import { SecretStore } from "../src/secrets/secret-store.js";

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

describe("IntegrationBroker user isolation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qa-integrations-test-"));
  const filePath = path.join(root, "integrations.json");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("keeps Alice and Bob credentials separate under concurrent tool calls", async () => {
    const provider: IntegrationProvider = {
      id: "bitrix24",
      displayName: "Bitrix24",
      capabilities: ["crm.read", "chat.read"],
      validate: async ({ credential }) => {
        const base = String(
          (JSON.parse(credential) as { webhookBaseUrl: string }).webhookBaseUrl,
        );
        return {
          tenantId: new URL(base).hostname,
          externalUserId: base.includes("alice") ? "alice" : "bob",
          displayName: base.includes("alice") ? "Alice" : "Bob",
          capabilities: ["crm.read", "chat.read"],
        };
      },
      execute: async ({ credential }, operation) => ({
        account: credential.includes("alice") ? "alice" : "bob",
        operation,
      }),
    };
    const providers = new IntegrationProviderRegistry();
    providers.register(provider);
    const repository = new IntegrationRepository(filePath);
    const broker = new IntegrationBroker(
      resolveConfig({ enabled: true }),
      repository,
      new SecretStore(
        new MemoryKeyProvider(new Map([[1, randomBytes(32)]]), 1),
      ),
      providers,
      fakeLogger(),
    );
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };
    const aliceSecret = "alice-secret-123";
    const bobSecret = "bob-secret-456";
    await broker.connectBitrix(alice, {
      token: `https://alice.bitrix24.ru/rest/1/${aliceSecret}`,
    });
    await broker.connectBitrix(bob, {
      token: `https://bob.bitrix24.ru/rest/2/${bobSecret}`,
    });

    const [aliceResult, bobResult] = await Promise.all([
      broker.call(alice, {
        provider: "bitrix24",
        operation: "crm.get",
        input: { entityTypeId: 2, id: 1 },
        sourceSessionId: "session-alice",
      }),
      broker.call(bob, {
        provider: "bitrix24",
        operation: "crm.get",
        input: { entityTypeId: 2, id: 1 },
        sourceSessionId: "session-bob",
      }),
    ]);
    expect(aliceResult.data).toMatchObject({ account: "alice" });
    expect(bobResult.data).toMatchObject({ account: "bob" });
    expect(broker.summary(alice, "bitrix24").externalAccountName).toBe("Alice");
    expect(broker.summary(bob, "bitrix24").externalAccountName).toBe("Bob");

    const persisted = readFileSync(filePath, "utf8");
    expect(persisted).not.toContain(aliceSecret);
    expect(persisted).not.toContain(bobSecret);
    expect(JSON.stringify(broker.summary(alice, "bitrix24"))).not.toContain(
      "secretRef",
    );

    expect(broker.disconnect(alice, "bitrix24")).toBe(true);
    await expect(
      broker.call(alice, {
        provider: "bitrix24",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-alice",
      }),
    ).rejects.toMatchObject({ code: "IntegrationNotConnected" });
    await expect(
      broker.call(bob, {
        provider: "bitrix24",
        operation: "crm.get",
        input: {},
        sourceSessionId: "session-bob",
      }),
    ).resolves.toMatchObject({ data: { account: "bob" } });
  });
});
