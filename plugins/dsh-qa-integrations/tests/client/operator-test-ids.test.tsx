// @vitest-environment jsdom

/**
 * The id contract of the operator card: how a settings path becomes the handle
 * a check reaches a knob by, and the promise that handle makes to a run. Epic
 * #453 wants a selector that survives a reworded caption and a switched
 * interface language, so the derivation is a rule with a shape to keep — ASCII
 * kebab-case, the card's zone in front, the keys of the path under it — and an
 * id that answers twice is a selector `getByTestId` throws on.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { OperatorCard } from "../../src/client/operator-card.js";
import { testIdOf } from "../../src/client/operator-controls.js";

/** The slot props the Host supplies are outside this test's concern. */
const Card = OperatorCard as unknown as (props: {
  form: unknown;
}) => ReactElement;

/** The card, mounted open over one stored configuration. */
function renderOpen(value: unknown): void {
  const snapshot = {
    status: "ready" as const,
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: "host" as const,
  };
  render(
    <Card
      form={{
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        mutate: async () => {},
        set: async () => {},
        unset: async () => {},
      }}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Развернуть конфигурацию интеграций" }),
  );
}

/**
 * The scopes an id has to be unique in: the card outside its list rows, and
 * every row of every list editor on its own. Epic #453 keeps the template id on
 * the rows of an editor, so uniqueness is a property of a row scope, not of the
 * document — and a field that shares its settings path with a sibling shows up
 * here as a duplicate before it shows up as a thrown `getByTestId`.
 */
function idScopes(): HTMLElement[][] {
  const rows = [
    ...document.querySelectorAll<HTMLElement>("[data-dsh-row-key]"),
  ];
  const insideRow = (node: HTMLElement): boolean =>
    rows.some((row) => row === node || row.contains(node));
  const loose = [
    ...document.querySelectorAll<HTMLElement>("[data-testid]"),
  ].filter((node) => !insideRow(node));
  return [
    loose,
    ...rows.map((row) => [
      row,
      ...row.querySelectorAll<HTMLElement>("[data-testid]"),
    ]),
  ];
}

describe("operator control test ids", () => {
  it("hangs the keys of a path off the card zone", () => {
    expect(testIdOf(["enabled"])).toBe("qa-integrations-enabled");
    expect(testIdOf(["gitlab", "maxFileBytes"])).toBe(
      "qa-integrations-gitlab-max-file-bytes",
    );
    expect(testIdOf(["managedServiceCredentials", "profiles"])).toBe(
      "qa-integrations-managed-service-credentials-profiles",
    );
    expect(testIdOf(["teamcity", "network", "allowedPorts"])).toBe(
      "qa-integrations-teamcity-network-allowed-ports",
    );
  });

  it("splits a segment the way a selector has to read it", () => {
    // An acronym run belongs to the word that follows it, or the key would
    // arrive glued together as `max-httpretries`.
    expect(testIdOf(["teamcity", "maxHTTPRetries"])).toBe(
      "qa-integrations-teamcity-max-http-retries",
    );
    // A dotted or underscored vocabulary key is one segment, and a dot inside an
    // id is a selector the harness cannot quote.
    expect(testIdOf(["credentialHelp", "issues.read"])).toBe(
      "qa-integrations-credential-help-issues-read",
    );
    expect(testIdOf(["credentialHelp", "merge_request"])).toBe(
      "qa-integrations-credential-help-merge-request",
    );
    // A key that needs no work keeps its own words in order.
    expect(testIdOf(["weblate", "screenshotsRead"])).toBe(
      "qa-integrations-weblate-screenshots-read",
    );
  });

  it("names every control of the card once, in ASCII kebab-case", () => {
    renderOpen({
      enabled: true,
      timeoutMs: 15000,
      allowedPortalSuffixes: [".bitrix24.ru"],
      gitlab: {
        enabled: true,
        maxFileBytes: 131072,
        // Two stored rows: the editor repeats its template id over them.
        instances: [
          { id: "corp", label: "Corp", baseUrl: "https://gitlab.example.corp" },
          { id: "edge", label: "Edge", baseUrl: "https://edge.example.corp" },
        ],
      },
      jira: {
        enabled: true,
        sites: [
          { id: "corp", label: "Corp", baseUrl: "https://jira.example.corp" },
        ],
        fieldAliases: { severity: "customfield_100" },
      },
      managedServiceCredentials: {
        enabled: true,
        defaultForNewConnections: true,
        // One profile that keeps two records under the same path.
        profiles: [
          {
            id: "qa-gitlab-readonly",
            provider: "gitlab",
            instance: "corp",
            label: "QA GitLab",
            enabled: true,
            resources: { projects: ["demo/repository"] },
            policy: { "mergeRequest.create": "deny" },
          },
        ],
      },
    });
    const scopes = idScopes();
    let named = 0;
    for (const scope of scopes) {
      const ids = scope.map((node) => String(node.getAttribute("data-testid")));
      // A repeated id is not a hint about the list: the check that meant to
      // reach one control reaches none.
      const repeats = ids.filter((id, at) => ids.indexOf(id) !== at);
      expect(repeats, "duplicate id inside one scope").toEqual([]);
      for (const id of ids) {
        expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
        named += 1;
      }
    }
    // A card that rendered nothing would pass the loops above.
    expect(named).toBeGreaterThan(100);
    expect(scopes.length).toBeGreaterThan(3);
  });
});
