// @vitest-environment jsdom

import type {
  QaUserSession,
  QaUserSessionSnapshot,
} from "@yadsh/dsh-qa-surface/client/settings";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createIntegrationsCard,
  createIntegrationsHostTab,
} from "../src/client/card.js";
import type { IntegrationsClientRemote } from "../src/client/integrations.js";
import { GITLAB_CAPABILITY_INFO } from "../src/providers/gitlab/catalog.js";
import type { IntegrationSummary } from "../src/types.js";

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
  it("keeps the card as a direct child of its host-tab list", () => {
    const HostTab = createIntegrationsHostTab(
      remote([]),
      ["gitlab"],
      session(ANONYMOUS),
    );
    render(<HostTab />);
    const list = screen.getByTestId("qa-integrations-host-tab");
    const shell = list.firstElementChild as HTMLElement;
    expect(shell.tagName).toBe("LI");
    expect(shell.classList.contains("dsh-plugin-card")).toBe(true);
  });

  it("mounts the shared card shell with a closed body", () => {
    // Anonymous on purpose: the shell test must not race the provider cards'
    // own loads.
    const Card = createIntegrationsCard(
      remote([]),
      ["gitlab"],
      session(ANONYMOUS),
    );
    const { container } = render(<Card />);
    expect(container.querySelector("li.dsh-plugin-card")).not.toBeNull();
    const header = screen.getByRole("button", {
      name: "Развернуть настройки интеграций",
    });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.className).toBe("dsh-plugin-card__header");
    expect(screen.getByText("Интеграции")).not.toBeNull();
    // The chevron is the shared inline SVG, never a font glyph.
    expect(
      container
        .querySelector("svg.dsh-plugin-card__chevron path")
        ?.getAttribute("d"),
    ).toBe("m3.5 5.25 3.5 3.5 3.5-3.5");
    expect(container.querySelector(".dsh-plugin-card__body")).toBeNull();

    fireEvent.click(header);
    expect(container.querySelector("li.dsh-plugin-card--open")).not.toBeNull();
    expect(container.querySelector(".dsh-plugin-card__body")).not.toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Свернуть настройки интеграций" }),
    ).toBe(header);
  });

  it("reads nothing until the operator opens the card", async () => {
    const calls: string[] = [];
    const Card = createIntegrationsCard(
      remote(calls),
      ["gitlab"],
      session(AUTHED),
    );
    render(<Card />);
    expect(calls).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть настройки интеграций" }),
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть настройки интеграций" }),
    );
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
    // while the dialog stayed open: the card must go with the button under it,
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
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть настройки интеграций" }),
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть настройки интеграций" }),
    );
    expect(
      screen.getByTestId("qa-integrations-settings-card-gate").textContent,
    ).toContain("Войдите в QA Surface");
    // The gate is the whole body: no provider card is mounted to fail.
    expect(
      screen.queryByTestId("qa-integrations-provider-card-gitlab"),
    ).toBeNull();
  });
});
