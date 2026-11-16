import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IntegrationBroker } from "../../src/broker.js";
import { resolveConfig } from "../../src/config.js";
import { Bitrix24Provider } from "../../src/providers/bitrix24/index.js";
import { IntegrationProviderRegistry } from "../../src/providers/registry.js";
import { IntegrationRepository } from "../../src/repository.js";
import { MemoryKeyProvider } from "../../src/secrets/key-provider.js";
import { SecretStore } from "../../src/secrets/secret-store.js";
import { ServiceCredentialRegistry } from "../../src/service-credentials/registry.js";
import { CREDENTIAL } from "../bitrix24/shared.js";
import { HARNESS_KEY, fakeLogger } from "./helpers.js";

describe("managed service validation through a real provider", () => {
  it.each([200, 403])(
    "uses the Bitrix24 transport and records an HTTP %i probe verdict",
    async (status) => {
      const root = mkdtempSync(path.join(tmpdir(), "qa-provider-probe-"));
      const repository = new IntegrationRepository(path.join(root, "test.db"));
      const methods: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        const method = new URL(String(input)).pathname.split("/").at(-1);
        methods.push(method!);
        return Response.json(
          method === "scope.json"
            ? { result: ["user", "crm"] }
            : { result: { ID: "7", NAME: "Demo", LAST_NAME: "User" } },
          { status },
        );
      };
      const config = resolveConfig({
        bitrix24: {
          instances: [
            { id: "demo", label: "Demo portal", portal: "company.bitrix24.ru" },
          ],
        },
        managedServiceCredentials: {
          enabled: true,
          profiles: [
            {
              id: "demo-readonly",
              provider: "bitrix24",
              instance: "demo",
              label: "Demo service",
              credential: { type: "webhook", secretEnv: "DEMO_WEBHOOK" },
              resources: { portals: ["company.bitrix24.ru"] },
            },
          ],
        },
      });
      const provider = new Bitrix24Provider(config, fetcher);
      const providers = new IntegrationProviderRegistry();
      providers.register(provider);
      const registry = new ServiceCredentialRegistry(
        config.managedServiceCredentials,
        (_, instance) => provider.instancePortal(instance),
        {
          env: {
            DEMO_WEBHOOK: (JSON.parse(CREDENTIAL) as { webhookBaseUrl: string })
              .webhookBaseUrl,
          },
        },
      );
      const broker = new IntegrationBroker(
        repository,
        new SecretStore(new MemoryKeyProvider(new Map([[1, HARNESS_KEY]]), 1)),
        providers,
        fakeLogger(),
        { serviceCredentials: registry },
      );
      const principal = { userId: "demo-user" };
      try {
        await broker.connect(principal, "bitrix24", { token: "" });
        const validation = broker.validate(principal, "bitrix24");
        if (status === 200) {
          await expect(validation).resolves.toMatchObject({
            status: "connected",
            errorCode: null,
            credentialSource: "service",
          });
          expect(methods).toEqual(["profile.json", "scope.json"]);
        } else {
          await expect(validation).rejects.toMatchObject({
            code: "CredentialRevoked",
          });
          expect(broker.summary(principal, "bitrix24")).toMatchObject({
            errorCode: "CredentialRevoked",
          });
          expect(methods).toEqual(["profile.json"]);
        }
      } finally {
        repository.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
