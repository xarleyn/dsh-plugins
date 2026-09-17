// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RemoteFailure } from "@deepseek-ai/dsh-typert-protocol";
import {
  createConfluenceCard,
  type ConfluenceRemote,
} from "../src/client/confluence.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels.
import { CONFLUENCE_CAPABILITY_INFO } from "../src/providers/confluence/catalog.js";
import type { IntegrationSummary } from "../src/types.js";

const SANDBOX = {
  id: "sandbox",
  label: "Sandbox",
  baseUrl: "https://sandbox.atlassian.net",
  service: null,
};
const SITES = [
  {
    id: "company",
    label: "Company",
    baseUrl: "https://company.atlassian.net",
    service: null,
  },
  SANDBOX,
];

const disconnected: IntegrationSummary = {
  provider: "confluence",
  displayName: "Confluence",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["identity.read", "content.read"],
  capabilityInfo: CONFLUENCE_CAPABILITY_INFO,
  policy: [
    { capability: "identity.read", mode: "allow" },
    { capability: "content.read", mode: "allow" },
  ],
  lastValidatedAt: null,
  errorCode: null,
  credentialSource: "personal",
  service: null,
};

const connected: IntegrationSummary = {
  ...disconnected,
  status: "connected",
  portal: "https://company.atlassian.net",
  externalAccountName: "Alice Example",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-16T06:00:00.000Z",
  lastValidatedAt: "2026-09-16T06:00:00.000Z",
};

/** The host answers a refused call with a typed remote failure, not an Error. */
function failure(message: string): RemoteFailure {
  return { message } as unknown as RemoteFailure;
}

function remote(overrides: Partial<ConfluenceRemote> = {}): ConfluenceRemote {
  return {
    confluenceSites: async () => ({ ok: true, value: SITES }),
    getConfluence: async () => ({ ok: true, value: disconnected }),
    putConfluenceCredential: async () => ({ ok: true, value: connected }),
    testConfluence: async () => ({ ok: true, value: connected }),
    patchConfluencePolicy: async () => ({ ok: true, value: connected }),
    disconnectConfluence: async () => ({ ok: true, value: true }),
    ...overrides,
  };
}

describe("Integrations Confluence card", () => {
  it("keeps the account e-mail and the API token write-only", async () => {
    const writes: { instanceId: string; email: string; token: string }[] = [];
    const Card = createConfluenceCard(
      remote({
        putConfluenceCredential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const select = await screen.findByLabelText("Сайт Confluence");
    expect(select).toHaveProperty("value", "");
    const token = screen.getByLabelText("Atlassian API token");
    expect(token).toHaveProperty("type", "password");
    const email = screen.getByLabelText("Почта аккаунта Atlassian");
    expect(email).toHaveProperty("type", "email");
    // The connect button stays locked until a site, an e-mail and a token exist.
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(select, { target: { value: "sandbox" } });
    fireEvent.change(email, { target: { value: "alice@example.com" } });
    fireEvent.click(connect);
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(token, { target: { value: "ATATT3xFfGF0secret" } });
    fireEvent.click(connect);
    await screen.findByText("Alice Example");
    expect(writes).toEqual([
      {
        instanceId: "sandbox",
        email: "alice@example.com",
        token: "ATATT3xFfGF0secret",
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByLabelText("Atlassian API token")).toBeNull(),
    );
    expect(container.textContent).not.toContain("ATATT3xFfGF0secret");
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("shows the single configured site without asking for a choice", async () => {
    const writes: string[] = [];
    const Card = createConfluenceCard(
      remote({
        confluenceSites: async () => ({ ok: true, value: [SANDBOX] }),
        putConfluenceCredential: async (_token, input) => {
          writes.push(input.instanceId);
          return { ok: true, value: connected };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    expect(await screen.findByText("Сайт: Sandbox")).toBeDefined();
    expect(screen.queryByLabelText("Сайт Confluence")).toBeNull();
    fireEvent.change(screen.getByLabelText("Почта аккаунта Atlassian"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Atlassian API token"), {
      target: { value: "ATATT3xFfGF0secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    );
    await waitFor(() => expect(writes).toEqual(["sandbox"]));
  });

  it("keeps the capability rows honest and patchable", async () => {
    const patched: string[] = [];
    const Card = createConfluenceCard(
      remote({
        getConfluence: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["content.read", "comments.read"],
            policy: [
              { capability: "content.read", mode: "allow" },
              { capability: "comments.read", mode: "deny" },
            ],
          },
        }),
        patchConfluencePolicy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const content = await screen.findByLabelText("Читать страницы");
    const comments = screen.getByLabelText("Читать комментарии");
    const versions = screen.getByLabelText("Читать версии страниц");
    expect(content).toHaveProperty("checked", true);
    expect(comments).toHaveProperty("checked", false);
    expect(comments).toHaveProperty("disabled", false);
    // A capability the deployment switched off is offered but locked.
    expect(versions).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Выключено оператором стенда");
    expect(container.textContent).toContain("Появится позже");

    fireEvent.click(comments);
    await waitFor(() => expect(patched).toEqual(["comments.read:allow"]));
  });

  it("explains a refusal that comes from the stand's space allowlist", async () => {
    const Card = createConfluenceCard(
      remote({
        getConfluence: async () => ({ ok: true, value: connected }),
        testConfluence: async () => ({
          ok: false,
          error: failure(
            "Integration request failed (reason: OperationDeniedByPolicy)",
          ),
        }),
      }),
    );
    render(<Card token="qa-account-token" />);
    await screen.findByText("Alice Example");
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await screen.findByText(/вне списка, разрешённого оператором стенда/u);
  });

  it("tells the user when the operator configured no site", async () => {
    const Card = createConfluenceCard(
      remote({ confluenceSites: async () => ({ ok: true, value: [] }) }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByText(/Оператор не настроил ни одного сайта Confluence/u);
    expect(container.textContent).not.toContain("Atlassian API token");
  });

  it("confirms before disconnecting and dropping the credential", async () => {
    let disconnectedCalls = 0;
    const Card = createConfluenceCard(
      remote({
        getConfluence: async () => ({ ok: true, value: connected }),
        disconnectConfluence: async () => {
          disconnectedCalls += 1;
          return { ok: true, value: true };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    await screen.findByText("Alice Example");
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
    expect(disconnectedCalls).toBe(0);
    const dialog = await screen.findByRole("alertdialog", {
      name: "Подтверждение отключения Confluence",
    });
    expect(dialog.textContent).toContain(
      "Отключить Confluence и удалить сохранённый токен?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Да, отключить" }));
    await waitFor(() => expect(disconnectedCalls).toBe(1));
  });
});
