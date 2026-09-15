// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createIntegrationsPage,
  type IntegrationsRemote,
} from "../src/client/IntegrationsPage.js";
import type { IntegrationSummary } from "../src/types.js";

const disconnected: IntegrationSummary = {
  provider: "bitrix24",
  displayName: "Bitrix24",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["crm.read", "chat.read"],
  policy: { "crm.read": "allow", "chat.read": "allow" },
  lastValidatedAt: null,
  errorCode: null,
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

describe("Integrations settings page", () => {
  it("keeps manual credentials write-only", async () => {
    const writes: string[] = [];
    const remote: IntegrationsRemote = {
      describe: async () => ({ ok: true, value: { enabled: true } }),
      getBitrix24: async () => ({ ok: true, value: disconnected }),
      putBitrix24Credential: async (_token, input) => {
        writes.push(input.token);
        return { ok: true, value: connected };
      },
      testBitrix24: async () => ({ ok: true, value: connected }),
      patchBitrix24Policy: async () => ({ ok: true, value: connected }),
      disconnectBitrix24: async () => ({ ok: true, value: true }),
    };
    const Page = createIntegrationsPage(remote);
    const { container } = render(<Page token="qa-account-token" />);
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
    expect(writes).toEqual([secret]);
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
    const remote: IntegrationsRemote = {
      describe: async () => ({ ok: true, value: { enabled: true } }),
      getBitrix24: async () => ({
        ok: true,
        value: {
          ...connected,
          capabilities: ["crm.read", "tasks.read"],
          policy: { "crm.read": "allow", "tasks.read": "deny" },
        },
      }),
      putBitrix24Credential: async () => ({ ok: true, value: connected }),
      testBitrix24: async () => ({ ok: true, value: connected }),
      patchBitrix24Policy: async (_token, patch) => {
        patched.push(`${patch.operation}:${patch.mode}`);
        return { ok: true, value: connected };
      },
      disconnectBitrix24: async () => ({ ok: true, value: true }),
    };
    const Page = createIntegrationsPage(remote);
    const { container } = render(<Page token="qa-account-token" />);

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
});
