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
          },
        ],
      };
    },
    getGitlab: async () => {
      calls.push("summary");
      return { ok: true, value: disconnected };
    },
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
    const { container } = render(<HostTab />);
    expect(
      container.querySelector(
        "ul.dsh-qa-integrations__host-tab > li.dsh-plugin-card",
      ),
    ).not.toBeNull();
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
    expect(await screen.findByText("GitLab")).not.toBeNull();
    expect(await screen.findByText("TeamCity")).not.toBeNull();
    // A provider the deployment did not mount stays absent.
    expect(screen.queryByText("Bitrix24")).toBeNull();
  });

  it("explains the account gate instead of showing forms that could only fail", () => {
    const Card = createIntegrationsCard(
      remote([]),
      ["gitlab"],
      session(ANONYMOUS),
    );
    const { container } = render(<Card />);
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть настройки интеграций" }),
    );
    expect(screen.getByText(/Войдите в QA Surface/u)).not.toBeNull();
    expect(container.querySelector(".dsh-qa-integrations__card")).toBeNull();
  });
});
