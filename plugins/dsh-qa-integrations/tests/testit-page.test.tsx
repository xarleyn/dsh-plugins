// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RemoteFailure } from "@deepseek-ai/dsh-typert-protocol";
import { createTestitCard, type TestitRemote } from "../src/client/testit.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels.
import { TESTIT_CAPABILITY_INFO } from "../src/providers/testit/catalog.js";
import type {
  IntegrationInstanceSummary,
  IntegrationSummary,
} from "../src/types.js";

const INSTANCE = "https://team.example.testit.software";

/** The host answers a refused call with a typed remote failure, not an Error. */
function failure(message: string): RemoteFailure {
  return { message } as unknown as RemoteFailure;
}

const disconnected: IntegrationSummary = {
  provider: "testit",
  displayName: "Test IT",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["projects.read", "workItems.read", "testRuns.read"],
  capabilityInfo: TESTIT_CAPABILITY_INFO,
  policy: [
    { capability: "projects.read", mode: "allow" },
    { capability: "workItems.read", mode: "allow" },
    { capability: "testRuns.read", mode: "allow" },
  ],
  lastValidatedAt: null,
  errorCode: null,
};

const connected: IntegrationSummary = {
  ...disconnected,
  status: "connected",
  portal: INSTANCE,
  externalAccountName: "Test IT Cloud · Test IT API v2, проектов видно: 7",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-17T06:00:00.000Z",
  lastValidatedAt: "2026-09-17T06:00:00.000Z",
};

const ONE: readonly IntegrationInstanceSummary[] = [
  { id: "cloud", label: "Test IT Cloud", baseUrl: INSTANCE },
];
const TWO: readonly IntegrationInstanceSummary[] = [
  ...ONE,
  { id: "tms", label: "TMS стенда", baseUrl: "https://tms.corp.example" },
];

function remote(overrides: Partial<TestitRemote> = {}): TestitRemote {
  return {
    testitInstances: async () => ({ ok: true, value: ONE }),
    getTestit: async () => ({ ok: true, value: disconnected }),
    putTestitCredential: async () => ({ ok: true, value: connected }),
    testTestit: async () => ({ ok: true, value: connected }),
    patchTestitPolicy: async () => ({ ok: true, value: connected }),
    disconnectTestit: async () => ({ ok: true, value: true }),
    ...overrides,
  };
}

describe("Integrations Test IT card", () => {
  it("keeps the API token write-only and the installation a choice, not a host", async () => {
    const writes: { instanceId: string; token: string }[] = [];
    const Card = createTestitCard(
      remote({
        testitInstances: async () => ({ ok: true, value: TWO }),
        putTestitCredential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const installation = await screen.findByLabelText("Инсталляция Test IT");
    const input = screen.getByLabelText("API-токен Test IT");
    expect(input).toHaveProperty("type", "password");
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);

    const secret = "abcdefghijklmnopqrstuvwxyz012345";
    fireEvent.change(input, { target: { value: secret } });
    // The secret alone is not enough: the installation has to be picked.
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(installation, { target: { value: "tms" } });
    fireEvent.click(connect);
    await screen.findByText(/Test IT Cloud/u);
    expect(writes).toEqual([{ instanceId: "tms", token: secret }]);
    await waitFor(() =>
      expect(screen.queryByLabelText("API-токен Test IT")).toBeNull(),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("names the one configured installation instead of asking for it", async () => {
    const Card = createTestitCard(remote());
    render(<Card token="qa-account-token" />);
    await screen.findByLabelText("API-токен Test IT");
    expect(screen.queryByLabelText("Инсталляция Test IT")).toBeNull();
    expect(screen.getByText(/Инсталляция: Test IT Cloud/u)).not.toBeNull();
  });

  it("keeps the capability rows honest and patchable", async () => {
    const patched: string[] = [];
    const Card = createTestitCard(
      remote({
        getTestit: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["projects.read", "workItems.read"],
            policy: [
              { capability: "projects.read", mode: "allow" },
              { capability: "workItems.read", mode: "deny" },
            ],
          },
        }),
        patchTestitPolicy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const projects = await screen.findByLabelText("Читать проекты");
    const workItems = screen.getByLabelText("Читать тест-кейсы");
    // A capability the deployment switched off is offered but locked.
    const attachments = screen.getByLabelText("Читать вложения");
    expect(projects).toHaveProperty("checked", true);
    expect(workItems).toHaveProperty("checked", false);
    expect(attachments).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Выключено оператором стенда");

    fireEvent.click(workItems);
    await waitFor(() => expect(patched).toEqual(["workItems.read:allow"]));
  });

  it("renders a policy failure instead of losing it", async () => {
    const Card = createTestitCard(
      remote({
        getTestit: async () => ({
          ok: false,
          error: failure("Integration request failed (reason: TlsFailure)"),
        }),
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await waitFor(() =>
      expect(container.textContent).toContain("Сертификат Test IT не принят"),
    );
  });

  it("asks for confirmation before dropping the stored token", async () => {
    let disconnectedCalls = 0;
    const Card = createTestitCard(
      remote({
        getTestit: async () => ({ ok: true, value: connected }),
        disconnectTestit: async () => {
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

  it("offers no form while the operator configured no installation", async () => {
    let writes = 0;
    const Card = createTestitCard(
      remote({
        testitInstances: async () => ({ ok: true, value: [] }),
        putTestitCredential: async () => {
          writes += 1;
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByText(
      /Оператор не настроил ни одной инсталляции Test IT/u,
    );
    expect(screen.queryByLabelText("API-токен Test IT")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Сохранить и проверить" }),
    ).toBeNull();
    expect(writes).toBe(0);
    expect(container.textContent).toContain("Оператор не настроил");
  });
});
