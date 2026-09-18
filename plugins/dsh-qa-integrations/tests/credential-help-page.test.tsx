// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";
import { describe, expect, it } from "vitest";
import { createIntegrationsPage } from "../src/client/integrations.js";
import type { IntegrationsClientRemote } from "../src/client/integrations.js";
import { GITLAB_CAPABILITY_INFO } from "../src/providers/gitlab/catalog.js";
import { GITLAB_CREDENTIAL_HELP } from "../src/providers/gitlab/credential-help.js";
import type {
  IntegrationProviderSummary,
  IntegrationSummary,
} from "../src/types.js";

const INSTANCE = {
  id: "gitlab-com",
  label: "GitLab.com",
  baseUrl: "https://gitlab.com",
};

const disconnected: IntegrationSummary = {
  provider: "gitlab",
  displayName: "GitLab",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: ["identity.read"],
  capabilityInfo: GITLAB_CAPABILITY_INFO,
  policy: [],
  lastValidatedAt: null,
  errorCode: null,
};

function summary(help: CredentialHelp | null): IntegrationProviderSummary {
  return {
    id: "gitlab",
    displayName: "GitLab",
    enabled: true,
    authModes: ["token"],
    capabilities: ["identity.read"],
    credentialHelp: help,
  };
}

/**
 * The page renders only the provider it was told about, so the stub carries the
 * GitLab calls the card makes plus the provider list that brings the help.
 */
function remote(help: CredentialHelp | null): IntegrationsClientRemote {
  const ok = <T,>(value: T): Promise<RemoteResult<T>> =>
    Promise.resolve({ ok: true, value });
  return {
    providers: () => ok([summary(help)]),
    gitlabInstances: () => ok([INSTANCE]),
    getGitlab: () => ok(disconnected),
    putGitlabCredential: () => ok(disconnected),
    testGitlab: () => ok(disconnected),
    patchGitlabPolicy: () => ok(disconnected),
    disconnectGitlab: () => ok(true),
  } as unknown as IntegrationsClientRemote;
}

describe("Integrations credential help", () => {
  it("mounts the declared help next to the credential field", async () => {
    const Page = createIntegrationsPage(remote(GITLAB_CREDENTIAL_HELP), [
      "gitlab",
    ]);
    const { container } = render(<Page token="qa-token" />);
    expect(
      await screen.findByLabelText("Personal access token GitLab"),
    ).toBeDefined();

    const trigger = await screen.findByRole("button", {
      name: /Создать токен/u,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(
      container.querySelector(".dsh-credential-help__title")?.textContent,
    ).toBe("Personal access token GitLab");
    expect(screen.getByText("read_api — всё читаемое")).toBeDefined();
    const link = screen.getByRole("link", { name: "Создать токен" });
    expect(link.getAttribute("href")).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // The field keeps working next to the help.
    expect(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    ).toBeDefined();
  });

  it("renders the plain credential field when the deployment declared none", async () => {
    const Page = createIntegrationsPage(remote(null), ["gitlab"]);
    render(<Page token="qa-token" />);
    expect(
      await screen.findByLabelText("Personal access token GitLab"),
    ).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /Создать токен/u })).toBeNull();
  });

  it("never renders an address that could execute in the page", async () => {
    const Page = createIntegrationsPage(
      remote({
        kind: "custom",
        label: "Токен GitLab",
        obtain: { url: "javascript:alert(document.cookie)" },
        notes: ["Спросите токен у администратора стенда."],
      }),
      ["gitlab"],
    );
    const { container } = render(<Page token="qa-token" />);
    await screen.findByLabelText("Personal access token GitLab");
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it("keeps whatever was typed in the field out of the help", async () => {
    const secret = "glpat-abcdefghij0123456789";
    const Page = createIntegrationsPage(remote(GITLAB_CREDENTIAL_HELP), [
      "gitlab",
    ]);
    const { container } = render(<Page token="qa-token" />);
    const input = await screen.findByLabelText("Personal access token GitLab");
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(
      await screen.findByRole("button", { name: /Создать токен/u }),
    );
    expect(container.textContent).not.toContain(secret);
    expect(container.querySelector("a[href*='glpat']")).toBeNull();
  });
});
