// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createGitlabCard, type GitlabRemote } from "../src/client/gitlab.js";
// The card renders whatever the host declares, so the fixture reuses the
// provider's own labels.
import { GITLAB_CAPABILITY_INFO } from "../src/providers/gitlab/catalog.js";
import type { IntegrationSummary } from "../src/types.js";

const CORP = {
  id: "corp",
  label: "Corporate GitLab",
  baseUrl: "https://gitlab.example.internal",
};
const INSTANCES = [
  { id: "gitlab-com", label: "GitLab.com", baseUrl: "https://gitlab.com" },
  CORP,
];

const disconnected: IntegrationSummary = {
  provider: "gitlab",
  displayName: "GitLab",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["identity.read", "projects.read"],
  capabilityInfo: GITLAB_CAPABILITY_INFO,
  policy: [
    { capability: "identity.read", mode: "allow" },
    { capability: "projects.read", mode: "allow" },
  ],
  lastValidatedAt: null,
  errorCode: null,
};

const connected: IntegrationSummary = {
  ...disconnected,
  status: "connected",
  portal: "https://gitlab.com",
  externalAccountName: "Alice Example (@alice)",
  credentialConfigured: true,
  credentialUpdatedAt: "2026-09-15T06:00:00.000Z",
  lastValidatedAt: "2026-09-15T06:00:00.000Z",
};

function remote(overrides: Partial<GitlabRemote> = {}): GitlabRemote {
  return {
    gitlabInstances: async () => ({ ok: true, value: INSTANCES }),
    getGitlab: async () => ({ ok: true, value: disconnected }),
    putGitlabCredential: async () => ({ ok: true, value: connected }),
    testGitlab: async () => ({ ok: true, value: connected }),
    patchGitlabPolicy: async () => ({ ok: true, value: connected }),
    disconnectGitlab: async () => ({ ok: true, value: true }),
    ...overrides,
  };
}

describe("Integrations GitLab card", () => {
  it("keeps the personal access token write-only", async () => {
    const writes: { instanceId: string; token: string }[] = [];
    const Card = createGitlabCard(
      remote({
        putGitlabCredential: async (_token, input) => {
          writes.push(input);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const select = await screen.findByLabelText("Инстанс GitLab");
    expect(select).toHaveProperty("value", "");
    const input = screen.getByLabelText("Personal access token GitLab");
    expect(input).toHaveProperty("type", "password");
    // The connect button stays locked until an instance is chosen.
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(select, { target: { value: "corp" } });
    const secret = "glpat-abcdefghij0123456789";
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(connect);
    await screen.findByText("Alice Example (@alice)");
    expect(writes).toEqual([{ instanceId: "corp", token: secret }]);
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Personal access token GitLab"),
      ).toBeNull(),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.textContent).not.toContain("Показать токен");
  });

  it("shows the single configured instance without asking for a choice", async () => {
    const writes: string[] = [];
    const Card = createGitlabCard(
      remote({
        gitlabInstances: async () => ({ ok: true, value: [CORP] }),
        putGitlabCredential: async (_token, input) => {
          writes.push(input.instanceId);
          return { ok: true, value: connected };
        },
      }),
    );
    render(<Card token="qa-account-token" />);
    expect(await screen.findByText("Инстанс: Corporate GitLab")).toBeDefined();
    expect(screen.queryByLabelText("Инстанс GitLab")).toBeNull();
    fireEvent.change(screen.getByLabelText("Personal access token GitLab"), {
      target: { value: "glpat-abcdefghij0123456789" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    );
    await waitFor(() => expect(writes).toEqual(["corp"]));
  });

  it("keeps the capability rows honest and patchable", async () => {
    const patched: string[] = [];
    const Card = createGitlabCard(
      remote({
        getGitlab: async () => ({
          ok: true,
          value: {
            ...connected,
            capabilities: ["projects.read", "ci.read"],
            policy: [
              { capability: "projects.read", mode: "allow" },
              { capability: "ci.read", mode: "deny" },
            ],
          },
        }),
        patchGitlabPolicy: async (_token, patch) => {
          patched.push(`${patch.operation}:${patch.mode}`);
          return { ok: true, value: connected };
        },
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    const projects = await screen.findByLabelText("Читать проекты");
    const ci = screen.getByLabelText("Читать CI/CD");
    const repository = screen.getByLabelText("Читать репозитории");
    expect(projects).toHaveProperty("checked", true);
    expect(ci).toHaveProperty("checked", false);
    expect(ci).toHaveProperty("disabled", false);
    // A capability the token does not grant is offered but locked.
    expect(repository).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Нет в правах токена");

    fireEvent.click(ci);
    await waitFor(() => expect(patched).toEqual(["ci.read:allow"]));
  });

  it("tells the user when the operator configured no instance", async () => {
    const Card = createGitlabCard(
      remote({ gitlabInstances: async () => ({ ok: true, value: [] }) }),
    );
    const { container } = render(<Card token="qa-account-token" />);
    await screen.findByText(/Оператор не настроил ни одного инстанса/u);
    expect(container.textContent).not.toContain("Personal access token");
  });
});
