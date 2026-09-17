// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GITLAB_CAPABILITY_INFO } from "../src/providers/gitlab/catalog.js";
import type { GitlabRemote } from "../src/client/gitlab.js";
import { createGitlabCard } from "../src/client/gitlab.js";
import type {
  CredentialSource,
  IntegrationServiceBoundary,
  IntegrationSummary,
} from "../src/types.js";

const CORP = {
  id: "corp",
  label: "Corporate GitLab",
  baseUrl: "https://gitlab.example.internal",
  service: null,
};

const MANAGED_CORP = {
  ...CORP,
  service: { label: "QA GitLab Read-only" },
};

const CAPABILITIES = [
  "identity.read",
  "projects.read",
  "repository.read",
  "search.read",
  "issues.read",
  "merge_requests.read",
  "ci.metadata.read",
] as const;

const SERVICE_CAPABILITY_STATE = {
  "identity.read": "available",
  "projects.read": "available",
  "repository.read": "available",
  "search.read": "available",
  "issues.read": "available",
  "merge_requests.read": "available",
  "ci.metadata.read": "available",
  "ci.logs.read": "sensitive",
} as const;

const SERVICE = {
  available: true,
  label: "QA GitLab Read-only",
  resources: { projects: ["1208", "1337"] },
  selection: null,
  capabilities: SERVICE_CAPABILITY_STATE,
};

const DISCONNECTED: IntegrationSummary = {
  provider: "gitlab",
  displayName: "GitLab",
  status: "not_connected",
  portal: null,
  externalAccountName: null,
  credentialConfigured: false,
  credentialUpdatedAt: null,
  capabilities: [],
  capabilityInfo: GITLAB_CAPABILITY_INFO,
  policy: [],
  lastValidatedAt: null,
  errorCode: null,
  credentialSource: "personal",
  service: { ...SERVICE, available: false, label: null, resources: null },
};

const SERVICE_CONNECTED: IntegrationSummary = {
  ...DISCONNECTED,
  status: "connected",
  portal: CORP.baseUrl,
  externalAccountName: "QA GitLab Read-only",
  capabilities: [...CAPABILITIES],
  policy: CAPABILITIES.map((capability) => ({
    capability,
    mode: "allow" as const,
  })),
  lastValidatedAt: "2026-09-15T06:00:00.000Z",
  credentialSource: "service",
  service: SERVICE,
};

interface Recorded {
  readonly saves: {
    readonly token: string;
    readonly useServiceCredential?: boolean;
  }[];
  readonly sources: CredentialSource[];
  readonly boundaries: (IntegrationServiceBoundary | null)[];
}

function remote(
  recorded: Recorded,
  overrides: Partial<GitlabRemote> = {},
): GitlabRemote {
  return {
    gitlabInstances: async () => ({ ok: true, value: [MANAGED_CORP] }),
    getGitlab: async () => ({ ok: true, value: DISCONNECTED }),
    putGitlabCredential: async (_token, input) => {
      recorded.saves.push(input);
      return { ok: true, value: SERVICE_CONNECTED };
    },
    testGitlab: async () => ({ ok: true, value: SERVICE_CONNECTED }),
    patchGitlabPolicy: async () => ({ ok: true, value: SERVICE_CONNECTED }),
    disconnectGitlab: async () => ({ ok: true, value: true }),
    managedServiceCredentials: async () => ({
      ok: true,
      value: { enabled: true, defaultForNewConnections: true },
    }),
    credentialSource: async (_token, input) => {
      recorded.sources.push(input.source);
      return {
        ok: true,
        value: {
          ...SERVICE_CONNECTED,
          credentialSource: input.source,
        },
      };
    },
    serviceBoundary: async (_token, input) => {
      recorded.boundaries.push(input.selection);
      return {
        ok: true,
        value: {
          ...SERVICE_CONNECTED,
          service: { ...SERVICE, selection: input.selection },
        },
      };
    },
    ...overrides,
  };
}

function recorded(): Recorded {
  return { saves: [], sources: [], boundaries: [] };
}

describe("GitLab card: managed service credential", () => {
  it("offers the service token checked by default and drops the secret field", async () => {
    const seen = recorded();
    const Card = createGitlabCard(remote(seen));
    render(<Card token="qa-account-token" />);

    const checkbox = await screen.findByLabelText(
      "Использовать сервисный токен",
    );
    expect(checkbox).toHaveProperty("checked", true);
    expect(screen.queryByLabelText("Personal access token GitLab")).toBeNull();
    expect(screen.getByText(/QA GitLab Read-only/u)).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Подключить сервисный токен" }),
    );
    await waitFor(() =>
      expect(seen.saves).toEqual([
        { instanceId: "corp", token: "", useServiceCredential: true },
      ]),
    );
  });

  it("returns to the personal form when the checkbox is cleared", async () => {
    const seen = recorded();
    const Card = createGitlabCard(remote(seen));
    render(<Card token="qa-account-token" />);

    const checkbox = await screen.findByLabelText(
      "Использовать сервисный токен",
    );
    fireEvent.click(checkbox);
    const token = await screen.findByLabelText("Personal access token GitLab");
    const connect = screen.getByRole("button", {
      name: "Сохранить и проверить",
    });
    expect(connect).toHaveProperty("disabled", true);
    fireEvent.change(token, {
      target: { value: "glpat-abcdefghij0123456789" },
    });
    fireEvent.click(connect);
    await waitFor(() =>
      expect(seen.saves).toEqual([
        {
          instanceId: "corp",
          token: "glpat-abcdefghij0123456789",
          useServiceCredential: false,
        },
      ]),
    );
  });

  it("shows no service option where the deployment manages none", async () => {
    const Card = createGitlabCard(
      remote(recorded(), {
        gitlabInstances: async () => ({ ok: true, value: [CORP] }),
      }),
    );
    render(<Card token="qa-account-token" />);
    await screen.findByLabelText("Personal access token GitLab");
    expect(screen.queryByLabelText("Использовать сервисный токен")).toBeNull();
  });

  it("describes a connected service mode and what it cannot read", async () => {
    const Card = createGitlabCard(
      remote(recorded(), {
        getGitlab: async () => ({ ok: true, value: SERVICE_CONNECTED }),
      }),
    );
    const { container } = render(<Card token="qa-account-token" />);

    expect(await screen.findByText(/QA GitLab Read-only/u)).not.toBeNull();
    expect(
      screen.getByText(/Сервисный аккаунт · управляется администратором/u),
    ).not.toBeNull();
    expect(
      screen.getByText(/Только безопасное чтение: изменения/u),
    ).not.toBeNull();
    expect(screen.getByText(/projects: 2 из 2/u)).not.toBeNull();

    // A capability the service credential can never reach is a locked row with
    // a reason, not a silent absence.
    const logRow = screen.getByLabelText("Читать лог джоба");
    expect(logRow).toHaveProperty("disabled", true);
    expect(screen.getAllByText("Требуется личный аккаунт").length).toBe(1);
    expect(container.textContent).not.toContain("QA_GITLAB");
  });

  it("keeps the personal form when a personal token is being replaced", async () => {
    // The deployment defaults new connections to the managed credential, which
    // must not turn "replace my token" into an offer to move the binding onto it.
    const personal: IntegrationSummary = {
      ...SERVICE_CONNECTED,
      credentialSource: "personal",
      externalAccountName: "Alice Example",
    };
    const Card = createGitlabCard(
      remote(recorded(), {
        getGitlab: async () => ({ ok: true, value: personal }),
      }),
    );
    render(<Card token="qa-account-token" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Заменить токен" }),
    );
    expect(
      await screen.findByLabelText("Personal access token GitLab"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Сохранить и проверить" }),
    ).not.toBeNull();
  });

  it("switches the binding back to the personal credential", async () => {
    const seen = recorded();
    const Card = createGitlabCard(
      remote(seen, {
        getGitlab: async () => ({ ok: true, value: SERVICE_CONNECTED }),
      }),
    );
    render(<Card token="qa-account-token" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Использовать личный аккаунт",
      }),
    );
    await waitFor(() => expect(seen.sources).toEqual(["personal"]));
  });

  it("saves a narrowed boundary and never offers a resource outside the allowlist", async () => {
    const seen = recorded();
    const Card = createGitlabCard(
      remote(seen, {
        getGitlab: async () => ({ ok: true, value: SERVICE_CONNECTED }),
      }),
    );
    render(<Card token="qa-account-token" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Изменить доступ" }),
    );
    expect(screen.getByLabelText("1208")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("1337")).toHaveProperty("checked", true);
    fireEvent.click(screen.getByLabelText("1337"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить доступ" }));
    await waitFor(() =>
      expect(seen.boundaries).toEqual([{ projects: ["1208"] }]),
    );
  });
});
