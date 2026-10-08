// @vitest-environment jsdom

import type {
  QaUserSession,
  QaUserSessionSnapshot,
} from "@yadsh/dsh-qa-surface/client/settings";
import { render, screen, waitFor } from "@testing-library/react";
import { createIntegrationsCard } from "../../src/client/card.js";
import type { IntegrationsClientRemote } from "../../src/client/integrations.js";
import { GITLAB_CAPABILITY_INFO } from "../../src/providers/gitlab/catalog.js";
import type { IntegrationSummary } from "../../src/types.js";

const ANONYMOUS: QaUserSessionSnapshot = { stage: "anonymous", token: null };
const AUTHED: QaUserSessionSnapshot = { stage: "authed", token: "qa-token" };

/** Session stub: the card reads it through useSyncExternalStore. */
function session(snapshot: QaUserSessionSnapshot): QaUserSession {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
}

const disconnected: IntegrationSummary = {
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
  service: null,
};

function remote(calls: string[]): IntegrationsClientRemote {
  return {
    gitlabInstances: async () => {
      calls.push("instances");
      return {
        ok: true,
        value: [
          {
            id: "gitlab-com",
            label: "GitLab.com",
            baseUrl: "https://gitlab.com",
            service: null,
          },
        ],
      };
    },
    getGitlab: async () => {
      calls.push("summary");
      return { ok: true, value: disconnected };
    },
    managedServiceCredentials: async () => ({
      ok: true,
      value: { enabled: false, defaultForNewConnections: false },
    }),
    getBitrix24: async () => ({ ok: true, value: disconnected }),
    getTeamcity: async () => ({ ok: true, value: disconnected }),
  } as unknown as IntegrationsClientRemote;
}

describe("Integrations plugin card", () => {
  it("renders the body with no frame and no expand control of ours", () => {
    // Anonymous on purpose: the chrome test must not race the provider cards'
    // own loads.
    const Card = createIntegrationsCard(
      remote([]),
      ["gitlab"],
      session(ANONYMOUS),
    );
    const { container } = render(<Card />);
    // The Plugins page draws this card's card surface, its title and its
    // disclosure, so a shell class, an `li` root or a toggle button here would
    // be a second card inside the Host's one.
    expect(container.querySelector("[class*='dsh-plugin-card']")).toBeNull();
    expect(container.querySelector("li")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    // The one heading names this section, at the level the page gives its section
    // titles: the host's bundle section carries no heading of its own —
    // `host-seat-contract.test.ts` reads that fact out of the installed page — while
    // the rows section beside it signs itself with an `<h4>` under an `<h3>` package
    // title. An `<h3>` of ours would sit beside the package name, not under it.
    expect(
      screen.getByRole("heading", { level: 4, name: "Интеграции" }),
    ).not.toBeNull();
    expect(container.querySelector("h3")).toBeNull();
    // The body is mounted at once — the page expands the section, not us.
    expect(screen.getByTestId("qa-integrations-bundle-card").className).toBe(
      "dsh-qa-integrations__body",
    );
    expect(screen.getByText("Интеграции")).not.toBeNull();
    expect(
      screen.getByTestId("qa-integrations-settings-card-gate").textContent,
    ).toContain("Войдите в QA Surface");
  });

  it("reads the deployment as soon as the page mounts the body", async () => {
    const calls: string[] = [];
    const Card = createIntegrationsCard(
      remote(calls),
      ["gitlab"],
      session(AUTHED),
    );
    render(<Card />);
    // Nothing is deferred to a disclosure we no longer own: the seat renders only
    // while the row's page is open, so the mount itself is the intent to read.
    await waitFor(() => {
      expect(calls).toContain("instances");
    });
  });

  it("renders the declared providers once a QA account is signed in", async () => {
    const Card = createIntegrationsCard(
      remote([]),
      ["gitlab", "teamcity"],
      session(AUTHED),
    );
    render(<Card />);
    expect(
      await screen.findByTestId("qa-integrations-provider-card-gitlab"),
    ).not.toBeNull();
    expect(
      await screen.findByTestId("qa-integrations-provider-card-teamcity"),
    ).not.toBeNull();
    // A provider the deployment did not mount stays absent.
    expect(
      screen.queryByTestId("qa-integrations-provider-card-bitrix24"),
    ).toBeNull();
    // Two cards mount together: each owns its zone, so no hook repeats and every
    // id stays an ASCII kebab-case selector.
    const ids = [...document.querySelectorAll("[data-testid]")].map((node) =>
      String(node.getAttribute("data-testid")),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
    }
  });

  it("drops a provider the service stopped offering", async () => {
    // The page was built for both providers, and the operator switched one off
    // while the page stayed open: the card must go with the button under it,
    // because the service no longer has a provider to connect to.
    const Card = createIntegrationsCard(
      {
        ...remote([]),
        providers: async () => ({
          ok: true,
          value: [
            {
              id: "gitlab",
              displayName: "GitLab",
              enabled: true,
              authModes: ["token"],
              capabilities: [],
              credentialHelp: null,
            },
          ],
        }),
      } as unknown as IntegrationsClientRemote,
      ["gitlab", "teamcity"],
      session(AUTHED),
    );
    render(<Card />);
    expect(
      await screen.findByTestId("qa-integrations-provider-card-gitlab"),
    ).not.toBeNull();
    await waitFor(() => {
      expect(
        screen.queryByTestId("qa-integrations-provider-card-teamcity"),
      ).toBeNull();
    });
  });

  it("explains the account gate instead of showing forms that could only fail", () => {
    const Card = createIntegrationsCard(
      remote([]),
      ["gitlab"],
      session(ANONYMOUS),
    );
    render(<Card />);
    expect(
      screen.getByTestId("qa-integrations-settings-card-gate").textContent,
    ).toContain("Войдите в QA Surface");
    // The gate is the whole body: no provider card is mounted to fail.
    expect(
      screen.queryByTestId("qa-integrations-provider-card-gitlab"),
    ).toBeNull();
  });
});
