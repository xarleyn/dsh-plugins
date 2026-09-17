// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RemoteFailure } from "@deepseek-ai/dsh-typert-protocol";
import {
  createTeamcityCard,
  type TeamcityRemote,
} from "../src/client/teamcity.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels.
import { TEAMCITY_CAPABILITY_INFO } from "../src/providers/teamcity/catalog.js";
import type { IntegrationSummary } from "../src/types.js";

const SERVER = "https://teamcity.example.com";

/** The host answers a refused call with a typed remote failure, not an Error. */
function failure(message: string): RemoteFailure {
  return { message } as unknown as RemoteFailure;
}

const disconnected: IntegrationSummary = {
  provider: "teamcity",
  displayName: "TeamCity",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["identity.read", "builds.read", "logs.read"],
  capabilityInfo: TEAMCITY_CAPABILITY_INFO,
  policy: [
    { capability: "identity.read", mode: "allow" },
    { capability: "builds.read", mode: "allow" },
    { capability: "logs.read", mode: "allow" },
  ],
  lastValidatedAt: null,
  errorCode: null,
  credentialSource: "personal",
  service: null,
};

const connected: IntegrationSummary = {
  ...disconnected,
  status: "connected",
  portal: SERVER,
  externalAccountName: "Alice Example (@alice) · TeamCity 2025.11",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-15T06:00:00.000Z",
  lastValidatedAt: "2026-09-15T06:00:00.000Z",
};

const SERVER_ROW = {
  id: "teamcity",
  label: "teamcity.example.com",
  baseUrl: SERVER,
  service: null,
};

function remote(overrides: Partial<TeamcityRemote> = {}): TeamcityRemote {
  return {
    getTeamcity: async () => ({ ok: true, value: disconnected }),
    teamcityServer: async () => ({ ok: true, value: SERVER_ROW }),
    putTeamcityCredential: async () => ({ ok: true, value: connected }),
    testTeamcity: async () => ({ ok: true, value: connected }),
    patchTeamcityPolicy: async () => ({ ok: true, value: connected }),
    disconnectTeamcity: async () => ({ ok: true, value: true }),
    managedServiceCredentials: async () => ({
      ok: true,
      value: { enabled: false, defaultForNewConnections: false },
    }),
    credentialSource: async () => ({ ok: true, value: connected }),
    serviceBoundary: async () => ({ ok: true, value: connected }),
    ...overrides,
  };
}

describe("Integrations TeamCity card", () => {
  it("keeps the access token write-only and the address out of the form", async () => {
    const writes: { token: string; useServiceCredential?: boolean }[] = [];
    const Card = createTeamcityCard(
      remote({
        putTeamcityCredential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const input = await screen.findByLabelText("Access token TeamCity");
    expect(input).toHaveProperty("type", "password");
    // The server is stand-wide configuration: the card shows it and never asks.
    expect(screen.queryByLabelText("Адрес TeamCity")).toBeNull();
    expect(
      screen.getByText(/Адрес TeamCity: teamcity.example.com/u),
    ).not.toBeNull();
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);
    const secret = "abcdefghijklmnopqrstuvwxyz012345";
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(connect);
    await screen.findByText(/Alice Example/u);
    expect(writes).toEqual([{ token: secret, useServiceCredential: false }]);
    await waitFor(() =>
      expect(screen.queryByLabelText("Access token TeamCity")).toBeNull(),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("keeps the capability rows honest and patchable", async () => {
    const patched: string[] = [];
    const Card = createTeamcityCard(
      remote({
        getTeamcity: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["builds.read", "logs.read"],
            policy: [
              { capability: "builds.read", mode: "allow" },
              { capability: "logs.read", mode: "deny" },
            ],
          },
        }),
        patchTeamcityPolicy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const builds = await screen.findByLabelText("Читать сборки");
    const logs = screen.getByLabelText("Читать лог сборки");
    // A capability the deployment switched off is offered but locked.
    const agents = screen.getByLabelText("Читать агентов");
    expect(builds).toHaveProperty("checked", true);
    expect(logs).toHaveProperty("checked", false);
    expect(agents).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Выключено оператором стенда");

    fireEvent.click(logs);
    await waitFor(() => expect(patched).toEqual(["logs.read:allow"]));
  });

  it("renders a policy failure instead of losing it", async () => {
    const Card = createTeamcityCard(
      remote({
        getTeamcity: async () => ({
          ok: false,
          error: failure("Integration request failed (reason: TlsFailure)"),
        }),
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await waitFor(() =>
      expect(container.textContent).toContain("Сертификат TeamCity не принят"),
    );
  });

  it("asks for confirmation before dropping the stored token", async () => {
    let disconnectedCalls = 0;
    const Card = createTeamcityCard(
      remote({
        getTeamcity: async () => ({ ok: true, value: connected }),
        disconnectTeamcity: async () => {
          disconnectedCalls += 1;
          return { ok: true, value: true };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Отключить" }));
    expect(disconnectedCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Да, отключить" }));
    await waitFor(() => expect(disconnectedCalls).toBe(1));
  });

  it("offers no form while the deployment configured no address", async () => {
    let writes = 0;
    const Card = createTeamcityCard(
      remote({
        teamcityServer: async () => ({ ok: true, value: null }),
        putTeamcityCredential: async () => {
          writes += 1;
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByText(/Оператор не настроил адрес TeamCity/u);
    expect(screen.queryByLabelText("Access token TeamCity")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Сохранить и проверить" }),
    ).toBeNull();
    expect(writes).toBe(0);
    expect(container.textContent).toContain("он один на всех");
  });
});
