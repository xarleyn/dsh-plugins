// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createBitrix24Card,
  type Bitrix24Remote,
  type IntegrationsRemote,
} from "../src/client/bitrix24.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels.
import { BITRIX24_CAPABILITY_INFO } from "../src/providers/bitrix24/catalog.js";
import type {
  CapabilityServiceState,
  IntegrationCapability,
  IntegrationServiceSummary,
  IntegrationSummary,
} from "../src/types.js";

const CORP = {
  id: "corp",
  label: "Corporate Bitrix24",
  baseUrl: "company.bitrix24.ru",
  service: null,
};

const disconnected: IntegrationSummary = {
  provider: "bitrix24",
  displayName: "Bitrix24",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["crm.read", "chat.read"],
  capabilityInfo: BITRIX24_CAPABILITY_INFO,
  policy: [
    { capability: "crm.read", mode: "allow" },
    { capability: "chat.read", mode: "allow" },
  ],
  lastValidatedAt: null,
  errorCode: null,
  credentialSource: "personal",
  service: null,
};

const connected: IntegrationSummary = {
  ...disconnected,
  status: "connected",
  portal: "company.bitrix24.ru",
  externalAccountName: "Иван Иванов",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-15T06:00:00.000Z",
  lastValidatedAt: "2026-09-15T06:00:00.000Z",
};

function remote(
  overrides: Partial<Bitrix24Remote & IntegrationsRemote> = {},
): Bitrix24Remote & IntegrationsRemote {
  return {
    describe: async () => ({
      ok: true,
      value: { enabled: true, providers: ["bitrix24", "gitlab"] },
    }),
    bitrix24Instances: async () => ({ ok: true, value: [CORP] }),
    getBitrix24: async () => ({ ok: true, value: disconnected }),
    putBitrix24Credential: async () => ({ ok: true, value: connected }),
    testBitrix24: async () => ({ ok: true, value: connected }),
    patchBitrix24Policy: async () => ({ ok: true, value: connected }),
    disconnectBitrix24: async () => ({ ok: true, value: true }),
    managedServiceCredentials: async () => ({
      ok: true,
      value: { enabled: false, defaultForNewConnections: false },
    }),
    credentialSource: async () => ({ ok: true, value: connected }),
    serviceBoundary: async () => ({ ok: true, value: connected }),
    ...overrides,
  };
}

const serviceCapabilities: Record<
  IntegrationCapability,
  CapabilityServiceState
> = Object.fromEntries(
  Object.keys(BITRIX24_CAPABILITY_INFO).map((capability) => [
    capability,
    capability === "crm.comment.write" ? "unavailable" : "available",
  ]),
) as Record<IntegrationCapability, CapabilityServiceState>;

const serviceSummary: IntegrationServiceSummary = {
  available: true,
  label: "QA Bitrix24 Read-only",
  resources: { portals: ["company.bitrix24.ru"] },
  selection: null,
  capabilities: serviceCapabilities,
};

const serviceConnected: IntegrationSummary = {
  ...connected,
  credentialSource: "service" as const,
  service: serviceSummary,
};

describe("Integrations Bitrix24 card", () => {
  it("keeps manual credentials write-only", async () => {
    const writes: {
      instanceId: string;
      token: string;
      useServiceCredential?: boolean;
    }[] = [];
    const Card = createBitrix24Card(
      remote({
        putBitrix24Credential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const input = await screen.findByLabelText(
      "URL входящего вебхука Bitrix24",
    );
    expect(input).toHaveProperty("type", "password");
    const secret = "https://company.bitrix24.ru/rest/1/secret-value-123";
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    );
    await screen.findByText("Иван Иванов");
    expect(writes).toEqual([
      { instanceId: "corp", token: secret, useServiceCredential: false },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByLabelText("URL входящего вебхука Bitrix24"),
      ).toBeNull(),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).toContain("Токен настроен");
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("shows one row per capability and disables the ones Bitrix24 withheld", async () => {
    const patched: string[] = [];
    const Card = createBitrix24Card(
      remote({
        getBitrix24: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["crm.read", "tasks.read"],
            policy: [
              { capability: "crm.read", mode: "allow" },
              { capability: "tasks.read", mode: "deny" },
            ],
          },
        }),
        patchBitrix24Policy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);

    const crm = await screen.findByLabelText("Читать CRM");
    const tasks = screen.getByLabelText("Читать задачи");
    const calendar = screen.getByLabelText("Читать календарь");
    const disk = screen.getByLabelText("Читать файлы Диска");
    expect(crm).toHaveProperty("checked", true);
    expect(tasks).toHaveProperty("checked", false);
    expect(tasks).toHaveProperty("disabled", false);
    expect(calendar).toHaveProperty("disabled", true);
    expect(disk).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Нет разрешения Bitrix24");

    fireEvent.click(tasks);
    await waitFor(() => expect(patched).toEqual(["tasks.read:allow"]));
  });

  it("connects through the managed credential without asking for a secret", async () => {
    const writes: {
      instanceId: string;
      token: string;
      useServiceCredential?: boolean;
    }[] = [];
    const Card = createBitrix24Card(
      remote({
        bitrix24Instances: async () => ({
          ok: true,
          value: [{ ...CORP, service: { label: "QA Bitrix24 Read-only" } }],
        }),
        managedServiceCredentials: async () => ({
          ok: true,
          value: { enabled: true, defaultForNewConnections: true },
        }),
        putBitrix24Credential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: serviceConnected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);

    // The service default is on and the deployment binds one portal: the form
    // opens without a webhook field at all. The instances arrive with the
    // card's async load, so wait for the connect button first.
    await screen.findByRole("button", { name: "Подключить сервисный токен" });
    expect(
      screen.queryByLabelText("URL входящего вебхука Bitrix24"),
    ).toBeNull();
    expect(container.textContent).toContain(
      "Сервисный аккаунт: QA Bitrix24 Read-only",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Подключить сервисный токен" }),
    );
    await screen.findByText("Сервисный аккаунт · управляется администратором");
    expect(writes).toEqual([
      {
        instanceId: "corp",
        token: "",
        useServiceCredential: true,
      },
    ]);
  });

  it("offers the personal webhook form when the service box is unchecked", async () => {
    const Card = createBitrix24Card(
      remote({
        bitrix24Instances: async () => ({
          ok: true,
          value: [{ ...CORP, service: { label: "QA Bitrix24 Read-only" } }],
        }),
        managedServiceCredentials: async () => ({
          ok: true,
          value: { enabled: true, defaultForNewConnections: true },
        }),
      }),
    );
    render(<Card token="qa-account-token" />);
    // The checkbox comes pre-checked from the deployment default; unchecking
    // it brings the webhook field back. It appears with the async load.
    fireEvent.click(
      await screen.findByLabelText(/Использовать сервисный токен/),
    );
    expect(
      await screen.findByLabelText("URL входящего вебхука Bitrix24"),
    ).toBeDefined();
  });
});
