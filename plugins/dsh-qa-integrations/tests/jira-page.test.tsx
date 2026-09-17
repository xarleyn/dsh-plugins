// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createJiraCard, type JiraRemote } from "../src/client/jira.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels.
import { JIRA_CAPABILITY_INFO } from "../src/providers/jira/catalog.js";
import type { IntegrationSummary } from "../src/types.js";

const COMPANY = {
  id: "company",
  label: "company.atlassian.net",
  baseUrl: "https://company.atlassian.net",
  service: null,
};
const SANDBOX = {
  id: "sandbox",
  label: "Sandbox",
  baseUrl: "https://sandbox.atlassian.net",
  service: null,
};
const SITES = [COMPANY, SANDBOX];

const disconnected: IntegrationSummary = {
  provider: "jira",
  displayName: "Jira",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["identity.read", "issues.read"],
  capabilityInfo: JIRA_CAPABILITY_INFO,
  policy: [
    { capability: "identity.read", mode: "allow" },
    { capability: "issues.read", mode: "allow" },
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
  externalAccountName: "Alice Example (alice@example.com)",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-16T06:00:00.000Z",
  lastValidatedAt: "2026-09-16T06:00:00.000Z",
};

function remote(overrides: Partial<JiraRemote> = {}): JiraRemote {
  return {
    jiraSites: async () => ({ ok: true, value: SITES }),
    getJira: async () => ({ ok: true, value: disconnected }),
    putJiraCredential: async () => ({ ok: true, value: connected }),
    testJira: async () => ({ ok: true, value: connected }),
    patchJiraPolicy: async () => ({ ok: true, value: connected }),
    disconnectJira: async () => ({ ok: true, value: true }),
    ...overrides,
  };
}

describe("Integrations Jira card", () => {
  it("keeps the API token and the account e-mail write-only", async () => {
    const writes: { siteId: string; email: string; token: string }[] = [];
    const Card = createJiraCard(
      remote({
        putJiraCredential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const select = await screen.findByLabelText("Сайт Jira");
    expect(select).toHaveProperty("value", "");
    const email = screen.getByLabelText("Аккаунт Atlassian (e-mail)");
    const input = screen.getByLabelText("API-токен Jira");
    expect(input).toHaveProperty("type", "password");
    // The connect button stays locked until a site and both values are there.
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(select, { target: { value: "company" } });
    fireEvent.change(email, { target: { value: "alice@example.com" } });
    expect(connect).toHaveProperty("disabled", true);
    const secret = "ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789";
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(connect);
    await screen.findByText("Alice Example (alice@example.com)");
    expect(writes).toEqual([
      { siteId: "company", email: "alice@example.com", token: secret },
    ]);
    await waitFor(() =>
      expect(screen.queryByLabelText("API-токен Jira")).toBeNull(),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("shows the single configured site without asking for a choice", async () => {
    const writes: string[] = [];
    const Card = createJiraCard(
      remote({
        jiraSites: async () => ({ ok: true, value: [COMPANY] }),
        putJiraCredential: async (_token, input) => {
          writes.push(input.siteId);
          return { ok: true, value: connected };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    expect(
      await screen.findByText(
        "Сайт: company.atlassian.net — задан оператором стенда",
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText("Сайт Jira")).toBeNull();
    fireEvent.change(screen.getByLabelText("Аккаунт Atlassian (e-mail)"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("API-токен Jira"), {
      target: { value: "ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    );
    await waitFor(() => expect(writes).toEqual(["company"]));
  });

  it("keeps the capability rows honest and patchable", async () => {
    const patched: string[] = [];
    const Card = createJiraCard(
      remote({
        getJira: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["issues.read", "comments.read"],
            policy: [
              { capability: "issues.read", mode: "allow" },
              { capability: "comments.read", mode: "deny" },
            ],
          },
        }),
        patchJiraPolicy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const issues = await screen.findByLabelText("Читать задачи");
    const comments = screen.getByLabelText("Читать комментарии");
    const fields = screen.getByLabelText("Читать схему полей");
    expect(issues).toHaveProperty("checked", true);
    expect(comments).toHaveProperty("checked", false);
    expect(comments).toHaveProperty("disabled", false);
    // A capability the deployment switched off is offered but locked.
    expect(fields).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Выключено оператором стенда");

    fireEvent.click(comments);
    await waitFor(() => expect(patched).toEqual(["comments.read:allow"]));
  });

  it("tells the user when the operator configured no site", async () => {
    const Card = createJiraCard(
      remote({ jiraSites: async () => ({ ok: true, value: [] }) }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByText(/Оператор не настроил ни одного сайта Jira/u);
    expect(container.textContent).not.toContain("API-токен Jira");
  });
});
