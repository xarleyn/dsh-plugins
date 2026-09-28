// @vitest-environment jsdom

/**
 * The operator card: it renders the deployment configuration from the bound
 * settings form, writes every edit as one path-addressed mutation, and
 * clears an override back to the composition layer. The namespace is the
 * plugin's configuration source, so a committed write is the deployment
 * change — the card adds no persistence of its own.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { OperatorCard } from "../src/client/operator-card.js";
import { SERVICE_REACH } from "../src/client/operator-service-reach.js";
import { GitlabSection } from "../src/client/operator-sections/gitlab.js";
import type { OperatorForm } from "../src/client/operator-sections/shared.js";

/** The slot props the Host supplies are outside this test's concern. */
const Card = OperatorCard as unknown as (props: {
  form: unknown;
}) => ReactElement;

interface ScopeOp {
  readonly op: string;
  readonly path: readonly string[];
  readonly value?: unknown;
}

interface ScopeStub {
  readonly writes: ScopeOp[];
  setStatus(status: "ready" | "unavailable"): void;
}

function scopeStub(initial: {
  value?: unknown;
  user?: unknown;
  writable?: boolean;
  status?: "ready" | "unavailable";
}): { form: never; stub: ScopeStub } {
  let snapshot = {
    status: (initial.status ?? "ready") as "ready" | "unavailable",
    value: initial.value,
    base: undefined as unknown,
    user: initial.user,
    revision: 1,
    writable: initial.writable ?? true,
    mode: "host" as const,
  };
  const listeners = new Set<() => void>();
  const writes: ScopeOp[] = [];
  const publish = () => {
    for (const listener of [...listeners]) listener();
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mutate: async (ops: readonly ScopeOp[]) => {
      const user = { ...((snapshot.user ?? {}) as Record<string, unknown>) };
      for (const op of ops) {
        writes.push(op);
        const segments = op.path.slice(0, -1);
        const leaf = op.path[op.path.length - 1] ?? "";
        let cursor = user;
        for (const segment of segments) {
          const next = {
            ...((cursor[segment] ?? {}) as Record<string, unknown>),
          };
          cursor[segment] = next;
          cursor = next;
        }
        if (op.op === "set") cursor[leaf] = op.value;
        else delete cursor[leaf];
      }
      snapshot = { ...snapshot, user };
      publish();
    },
    set: async () => {},
    unset: async () => {},
  };
  return {
    form: scope as never,
    stub: {
      writes,
      setStatus(status) {
        snapshot = { ...snapshot, status };
        publish();
      },
    },
  };
}

function renderCard(initial: {
  value?: unknown;
  user?: unknown;
  writable?: boolean;
  status?: "ready" | "unavailable";
}): ScopeStub {
  const { form, stub } = scopeStub(initial);
  render(<Card form={form} />);
  return stub;
}

/** The shell mounts collapsed; every section test expands it first. */
function expand(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Развернуть конфигурацию интеграций" }),
  );
}

/** The caption an element carries, normalised the way the queries compare it. */
function captionOf(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * The caption a labelled control prints, taken off the label it belongs to and
 * stripped of what the label carries besides it: the «переопределено» mark and,
 * on a toggle, the hint that sits beside the caption. Exact equality is what
 * makes the caption an assertion — a prefix check would let «CRM: чтение и
 * запись» pass for «CRM: чтение».
 */
function captionOfControl(control: HTMLInputElement): string {
  const labels = [...(control.labels ?? [])];
  expect(
    labels.length,
    `${control.getAttribute("data-testid")} is labelled once`,
  ).toBe(1);
  const label = labels[0] as Element;
  // A toggle keeps its caption in a <strong> of its own, apart from the hint.
  const caption = label.querySelector("strong") ?? label;
  const parts = [...caption.childNodes]
    .filter(
      (node) =>
        !(
          node instanceof Element &&
          node.matches("[data-testid$='-overridden']")
        ),
    )
    .map((node) => node.textContent ?? "");
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * The section one zone owns, found by its test id. The zones are `general`,
 * `service-access` and one per provider, so a knob is reached through the
 * provider that owns it whatever its caption happens to say in Russian.
 */
function sectionOf(zone: string): HTMLElement {
  return screen.getByTestId(`qa-integrations-${zone}`);
}

/** Opens a collapsed section the way a reader does: by its own summary. */
function openSection(zone: string): void {
  fireEvent.click(sectionOf(zone).querySelector("summary") as HTMLElement);
}

/**
 * The control that writes a settings path, found by its test id — the key the
 * Host stores the value under — instead of by the Russian caption the field
 * carries. A reworded hint or a switched interface language then no longer
 * moves a knob away from the check that reaches it. The lookup spans the card
 * because the id is unique outside a list row, which
 * `operator-test-ids.test.tsx` checks; where a test is about a knob sitting in a
 * section, it says so with `contains`.
 * What the caption is for stays asserted: the control must still carry exactly
 * that label, so the operator's handle and the test's cannot drift apart.
 */
function controlAt(testId: string, caption: string): HTMLElement {
  const control = screen.getByTestId(testId) as HTMLInputElement;
  expect(captionOfControl(control), `${testId} is captioned ${caption}`).toBe(
    caption,
  );
  return control;
}

/**
 * The `<button>` behind `testId`. The caption is what the operator reads before
 * clicking, so it stays the assertion; the id is what the test reaches by, so
 * neither the copy nor the accessible-name computation of the other thousand
 * buttons of this card is on the path of the lookup.
 */
function buttonAt(testId: string, caption: string): HTMLElement {
  const button = screen.getByTestId(testId);
  expect(button.localName, `${testId} is a button`).toBe("button");
  expect(captionOf(button), `${testId} is captioned ${caption}`).toBe(caption);
  return button;
}

/**
 * One row of a list editor, told apart by the value it carries instead of by
 * its place in the list. Epic #453 keeps the template id on every row of an
 * editor — the rows of `gitlab.instances` read alike — so the row's own key
 * attribute is the handle a check uses when it needs *this* row.
 */
function rowOf(fieldTestId: string, key: string): HTMLElement {
  const row = screen
    .getAllByTestId(`${fieldTestId}-row`)
    .find((node) => node.getAttribute("data-dsh-row-key") === key);
  expect(row, `the ${fieldTestId} row keyed ${key}`).toBeDefined();
  return row as HTMLElement;
}

/** Switches the reach table annotates — each one has to show up on the card. */
const SERVICE_REACH_ROWS = Object.values(SERVICE_REACH).reduce(
  (total, notes) => total + Object.keys(notes).length,
  0,
);

/**
 * The switches one provider section hands to the card's toggle, addressed by
 * the path they write and read as the values they show. Rendering the section
 * alone keeps this off the full-card budget the suite already spends.
 */
function sectionSwitches(
  section: (props: { readonly form: OperatorForm }) => ReactElement,
  config: Record<string, unknown>,
): Map<string, boolean> {
  const seen = new Map<string, boolean>();
  const form = {
    config,
    control: {
      disabled: true,
      write: () => {},
      unset: () => {},
      overridden: () => false,
    },
    toggle: (label: string, path: readonly string[], value: boolean) => {
      seen.set(path.join("."), value);
      return <span key={path.join(".")} />;
    },
  } as unknown as OperatorForm;
  const Section = section;
  render(<Section form={form} />);
  return seen;
}

const RESOLVED = {
  enabled: false,
  timeoutMs: 15000,
  maxResponseBytes: 2000000,
  auditRetentionDays: 90,
  allowedPortalSuffixes: [".bitrix24.ru"],
  bitrix24: { enabled: true, crmRead: true, crmCommentWrite: false },
  gitlab: {
    enabled: true,
    maxFileBytes: 131072,
    instances: [
      { id: "corp", label: "Corp", baseUrl: "https://gitlab.example.corp" },
    ],
  },
  teamcity: {
    enabled: true,
    serverUrl: "",
    network: {
      mode: "allowlist",
      allowedHosts: [],
      allowedCidrs: [],
      allowedPorts: [],
      allowHttp: false,
    },
  },
};

describe("integrations operator card", () => {
  it("stays hidden when the namespace is not exposed to this browser", () => {
    const { container } = render(
      <Card form={scopeStub({ status: "unavailable" }).form} />,
    );
    // The card renders null while the form reports the namespace absent.
    expect(container.childElementCount).toBe(0);
  });

  it("renders the deployment configuration sections", () => {
    renderCard({ value: RESOLVED });
    expand();
    expect(screen.getByTestId("qa-integrations-general")).toBeDefined();
    expect(screen.getByTestId("qa-integrations-bitrix24")).toBeDefined();
    expect(screen.getByTestId("qa-integrations-gitlab")).toBeDefined();
    expect(screen.getByTestId("qa-integrations-teamcity")).toBeDefined();
    expect(screen.getByTestId("qa-integrations-service-access")).toBeDefined();
    // The badge names the layer state: nothing overridden yet.
    expect(
      captionOf(screen.getByTestId("qa-integrations-override-badge")),
    ).toBe("по умолчанию");
    // The general section mounts open and the disabled plugin shows it.
    expect(
      (
        controlAt(
          "qa-integrations-enabled",
          "Плагин включён",
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    // No managed credential on this stand, so no switch claims a ceiling that
    // nobody can hit: the note appears only beside a slice that is in use.
    expect(
      [...document.querySelectorAll(".qai-op__toggle-copy > span")].filter(
        (span) => span.textContent?.includes("личный аккаунт"),
      ),
    ).toHaveLength(0);
  });

  it("summarises each collapsed provider in its header", () => {
    renderCard({ value: RESOLVED });
    expand();
    // GitLab: on, one instance, all eight capabilities on by default — CI
    // counts as the two halves the resolver actually answers with.
    expect(
      screen.getByText("включён · 1 инстанс · доступно 8 из 8"),
    ).toBeDefined();
    // Bitrix24 counts the deny-listed write tool as off.
    expect(screen.getByText("включён · доступно 8 из 9")).toBeDefined();
  });

  it("groups a provider into labelled blocks with the knobs folded away", () => {
    renderCard({ value: RESOLVED });
    expand();
    openSection("gitlab");
    const section = sectionOf("gitlab");
    const titles = [...section.querySelectorAll(".qai-op__group-title")].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual([
      "Провайдер",
      "Подключение",
      "Что доступно агенту",
      "Ограничения и повторы",
    ]);
    // Capabilities sit in their own checklist, connection editors own the row.
    expect(
      screen
        .getByTestId("qa-integrations-gitlab-capabilities")
        .classList.contains("qai-op__group--checks"),
    ).toBe(true);
    expect(
      screen
        .getByTestId("qa-integrations-gitlab-connection")
        .classList.contains("qai-op__group--wide"),
    ).toBe(true);
    // The numeric knobs stay folded until someone asks for them.
    const limits = screen.getByTestId(
      "qa-integrations-gitlab-limits",
    ) as HTMLDetailsElement;
    expect(limits.open).toBe(false);
    fireEvent.click(limits.querySelector("summary") as HTMLElement);
    expect(limits.open).toBe(true);
    const ceiling = controlAt(
      "qa-integrations-gitlab-max-file-bytes",
      "Потолок файла, байт",
    ) as HTMLInputElement;
    // The knob stayed inside the group the regrouping folded it into.
    expect(limits.contains(ceiling)).toBe(true);
    expect(ceiling.value).toBe("131072");
  });

  it("keeps every deployment knob reachable after the regrouping", () => {
    renderCard({ value: RESOLVED });
    expand();
    for (const zone of [
      "confluence",
      "gitlab",
      "teamcity",
      "jira",
      "testit",
      "weblate",
    ]) {
      openSection(zone);
    }
    // One representative of each kind, in each provider that has it. A knob is
    // named by the settings path it writes, so the caption the operator reads
    // is no longer on the path of the lookup — and a duplicated id is a failure
    // of `getByTestId` on its own.
    for (const field of [
      "qa-integrations-gitlab-instances-field",
      "qa-integrations-confluence-instances-field",
      "qa-integrations-teamcity-server-url-field",
      "qa-integrations-jira-sites-field",
      "qa-integrations-testit-instances-field",
      "qa-integrations-weblate-instances-field",
    ]) {
      expect(
        screen.getByTestId(field),
        `connection editor ${field}`,
      ).toBeTruthy();
    }
    // A capability of each provider, named by the switch the Host reads and
    // read back through the checklist that owns it — which is what "its
    // deployment knobs" means here. The caption stays the assertion. GitLab CI
    // is the two halves the resolver answers with, not the `ciRead` alias one
    // released hid behind a single switch.
    for (const [zone, key, caption] of [
      ["confluence", "versions-read", "Версии: чтение"],
      ["gitlab", "ci-metadata-read", "CI: пайплайны и джобы: чтение"],
      ["gitlab", "ci-logs-read", "CI: лог джоба: чтение"],
      ["teamcity", "agents-read", "Агенты: чтение"],
      ["jira", "transitions-read", "Переходы: чтение"],
      ["testit", "auto-tests-read", "Автотесты: чтение"],
      ["weblate", "screenshots-read", "Скриншоты: чтение"],
    ] as const) {
      const id = `qa-integrations-${zone}-${key}`;
      const control = controlAt(id, caption);
      expect(
        screen
          .getByTestId(`qa-integrations-${zone}-capabilities`)
          .contains(control),
        `${id} sits in the capabilities checklist`,
      ).toBe(true);
    }
  });

  it("reads GitLab's CI halves through the single switch they replaced", () => {
    // `resolveGitlabConfig` keeps a pre-split `ciRead` governing both halves
    // until one of them is named. A card that read the halves alone would show
    // them enabled over a deployment that switched CI off — and would then write
    // a half that quietly overrides the alias it still displays as on.
    const aliased = sectionSwitches(GitlabSection, {
      gitlab: { ciRead: false },
    });
    expect(aliased.get("gitlab.ciMetadataRead")).toBe(false);
    expect(aliased.get("gitlab.ciLogsRead")).toBe(false);
    // An explicit half wins over the alias, which is the resolver's own order.
    const halved = sectionSwitches(GitlabSection, {
      gitlab: { ciRead: false, ciLogsRead: true },
    });
    expect(halved.get("gitlab.ciMetadataRead")).toBe(false);
    expect(halved.get("gitlab.ciLogsRead")).toBe(true);
    // Nothing named reads the schema default, as it did before the split.
    const fresh = sectionSwitches(GitlabSection, { gitlab: {} });
    expect(fresh.get("gitlab.ciMetadataRead")).toBe(true);
    expect(fresh.get("gitlab.ciLogsRead")).toBe(true);
  });

  it("writes a capability toggle as one path-addressed set", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    // The Bitrix24 section is collapsed until opened.
    openSection("bitrix24");
    const crm = controlAt(
      "qa-integrations-bitrix24-crm-read",
      "CRM: чтение",
    ) as HTMLInputElement;
    expect(crm.checked).toBe(true);
    fireEvent.click(crm);
    expect(stub.writes).toEqual([
      { op: "set", path: ["bitrix24", "crmRead"], value: false },
    ]);
  });

  it("enables the plugin from the always-open general section", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    fireEvent.click(controlAt("qa-integrations-enabled", "Плагин включён"));
    expect(stub.writes).toEqual([
      { op: "set", path: ["enabled"], value: true },
    ]);
  });

  it("marks overridden fields and clears the whole override layer", () => {
    const stub = renderCard({
      value: RESOLVED,
      user: { teamcity: { serverUrl: "https://teamcity.example.corp" } },
    });
    expect(
      captionOf(screen.getByTestId("qa-integrations-override-badge")),
    ).toBe("переопределено: 1");
    expand();
    fireEvent.click(
      buttonAt(
        "qa-integrations-reset-overrides",
        "Сбросить переопределения (1)",
      ),
    );
    expect(stub.writes).toEqual([{ op: "unset", path: ["teamcity"] }]);
  });

  it("shows read-only copy when the Host document takes no writes", () => {
    renderCard({ value: RESOLVED, writable: false });
    expand();
    // The banner is named by what it reports, so it no longer has to be told
    // apart from the list editors that repeat the same words about a row they
    // could not commit; the copy it shows is still what the check reads.
    expect(captionOf(screen.getByTestId("qa-integrations-read-only"))).toMatch(
      /^Хост не принимает правки из этого браузера/u,
    );
    const toggle = controlAt(
      "qa-integrations-enabled",
      "Плагин включён",
    ) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });

  it("writes the deployment of a Jira site back with the row", () => {
    const stub = renderCard({
      value: {
        ...RESOLVED,
        jira: {
          enabled: true,
          sites: [
            { id: "corp", label: "Corp", baseUrl: "https://jira.example.corp" },
          ],
        },
      },
    });
    expand();
    const select = screen.getByTestId(
      "qa-integrations-jira-sites-deployment-select",
    ) as HTMLSelectElement;
    // A site that names no product reads as the Host resolver's own default.
    expect(select.value).toBe("cloud");
    fireEvent.change(select, { target: { value: "server" } });
    expect(stub.writes).toEqual([
      {
        op: "set",
        path: ["jira", "sites"],
        value: [
          {
            id: "corp",
            label: "Corp",
            baseUrl: "https://jira.example.corp",
            deploymentType: "server",
          },
        ],
      },
    ]);
  });

  it("keeps the canonical deployment of a Confluence instance through an edit", () => {
    const stub = renderCard({
      value: {
        ...RESOLVED,
        confluence: {
          enabled: true,
          instances: [
            {
              id: "wiki",
              label: "Wiki",
              baseUrl: "https://wiki.example.corp",
              // The Host resolves both spellings to `server`, so the row reads
              // and writes back the value the control can show.
              deploymentType: "datacenter",
            },
          ],
        },
      },
    });
    expand();
    // The row the fixture stores is the one keyed `wiki`, not "the first row".
    const row = rowOf("qa-integrations-confluence-instances", "wiki");
    const select = within(row).getByTestId(
      "qa-integrations-confluence-instances-deployment-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("server");
    const label = within(row).getByTestId(
      "qa-integrations-confluence-instances-label-input",
    ) as HTMLInputElement;
    fireEvent.change(label, { target: { value: "Корпоративная вики" } });
    fireEvent.blur(label);
    expect(stub.writes).toEqual([
      {
        op: "set",
        path: ["confluence", "instances"],
        value: [
          {
            id: "wiki",
            label: "Корпоративная вики",
            baseUrl: "https://wiki.example.corp",
            deploymentType: "server",
          },
        ],
      },
    ]);
  });

  it("offers the deployment control only to Jira and Confluence", () => {
    renderCard({
      value: {
        ...RESOLVED,
        confluence: {
          enabled: true,
          instances: [
            {
              id: "wiki",
              label: "Wiki",
              baseUrl: "https://wiki.example.corp",
              deploymentType: "server",
            },
          ],
        },
        jira: {
          enabled: true,
          sites: [
            { id: "corp", label: "Corp", baseUrl: "https://jira.example.corp" },
          ],
        },
      },
    });
    expand();
    for (const zone of ["confluence", "jira", "gitlab"]) {
      openSection(zone);
    }
    // A row carries the deployment control only where the provider has one, so
    // the count of these ids is the answer; the path they hang off says which
    // provider's rows they are.
    const deploymentControls = (testId: string): number =>
      screen.queryAllByTestId(testId).length;
    // One control per row of the two providers that distinguish a deployment…
    expect(
      deploymentControls(
        "qa-integrations-confluence-instances-deployment-select",
      ),
    ).toBe(1);
    expect(
      deploymentControls("qa-integrations-jira-sites-deployment-select"),
    ).toBe(1);
    // …and none at all for a provider that has no such distinction.
    expect(
      deploymentControls("qa-integrations-gitlab-instances-deployment-select"),
    ).toBe(0);
  });

  it("starts a row the operator adds on the Cloud default", () => {
    const stub = renderCard({
      value: { ...RESOLVED, jira: { enabled: true, sites: [] } },
    });
    expand();
    // The add button of this editor, named by the path its rows write: the
    // field-alias record editor further down carries one of its own.
    fireEvent.click(screen.getByTestId("qa-integrations-jira-sites-add"));
    const select = screen.getByTestId(
      "qa-integrations-jira-sites-deployment-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("cloud");
    // An unfinished row stays a local draft, so nothing is committed yet.
    expect(stub.writes).toEqual([]);
  });

  it("keeps an unfinished instance draft local when the stored row is removed", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    fireEvent.click(screen.getByTestId("qa-integrations-gitlab-instances-add"));
    const rows = () =>
      screen.getAllByTestId("qa-integrations-gitlab-instances-row");
    expect(rows()).toHaveLength(2);
    stub.writes.splice(0);

    // Both rows wear the template id, so the one to remove is the row the
    // deployment stored — the node keyed `corp`, not the first of the two.
    fireEvent.click(
      within(rowOf("qa-integrations-gitlab-instances", "corp")).getByTestId(
        "qa-integrations-gitlab-instances-remove",
      ),
    );

    expect(stub.writes).toEqual([
      { op: "unset", path: ["gitlab", "instances"] },
    ]);
    // The draft the operator started stays on screen.
    expect(rows()).toHaveLength(1);
  });

  it("shows a new service profile as a local draft without storing it", () => {
    const stub = renderCard({
      value: {
        ...RESOLVED,
        managedServiceCredentials: {
          enabled: true,
          defaultForNewConnections: true,
          profiles: [],
        },
      },
    });
    expand();
    // This render is the one with managed credentials on, so it also answers
    // issue #285: the operator ticked «Логи сборок: чтение», the stand really
    // does grant it, and a tester on the read-only service account is still
    // refused — the switch has to say so where it was ticked.
    const checks = screen.getByTestId("qa-integrations-teamcity-capabilities");
    const logs = controlAt(
      "qa-integrations-teamcity-logs-read",
      "Логи сборок: чтение",
    );
    expect(checks.contains(logs)).toBe(true);
    expect(logs.closest("label")?.textContent).toContain("личный аккаунт");
    // A switch the credential does reach carries no note, so the ones that do
    // keep meaning something.
    const failures = controlAt(
      "qa-integrations-teamcity-failures-read",
      "Провалы: чтение",
    );
    expect(failures.closest("label")?.textContent).not.toContain(
      "личный аккаунт",
    );
    // Every row of the table reaches the card, exactly once: the annotation is
    // one lookup inside the card's toggle, so this count is the card↔table half
    // of the drift check tests/operator-service-reach.test.ts cannot cover.
    const notes = [
      ...document.querySelectorAll(".qai-op__toggle-copy > span"),
    ].filter((span) => span.textContent?.includes("личный аккаунт"));
    expect(notes).toHaveLength(SERVICE_REACH_ROWS);

    openSection("service-access");
    fireEvent.click(
      screen.getByTestId("qa-integrations-service-access-add-profile"),
    );

    expect(
      screen.queryAllByTestId(/^qa-integrations-service-access-profile-\d+$/u),
    ).toHaveLength(1);
    expect(screen.getByText(/не сохранено — нужно: id/u)).toBeDefined();
    expect(stub.writes).toEqual([]);
  });

  it("edits the controlled service-profile row and stores its wire shape", () => {
    const stub = renderCard({
      value: {
        ...RESOLVED,
        managedServiceCredentials: {
          enabled: true,
          defaultForNewConnections: true,
          profiles: [
            {
              id: "qa-gitlab-readonly",
              provider: "gitlab",
              instance: "corp",
              label: "QA GitLab",
              enabled: true,
              resources: { projects: ["demo/repository"] },
            },
          ],
        },
      },
    });
    expand();
    openSection("service-access");
    const id = screen
      .getByTestId("qa-integrations-service-access-profile-0")
      .querySelector("input[type='text']") as HTMLInputElement;

    fireEvent.change(id, { target: { value: "qa-gitlab-audit" } });
    expect(id.value).toBe("qa-gitlab-audit");
    expect(stub.writes).toEqual([]);
    // The row is keyed by its own id, so renaming it re-mounts it: the controls
    // are read from the row that stands after the commit, not from the node the
    // edit started on.
    fireEvent.click(
      screen
        .getByTestId("qa-integrations-service-access-profile-0")
        .querySelector("input[type='checkbox']") as HTMLInputElement,
    );

    expect(stub.writes).toEqual([
      {
        op: "set",
        path: ["managedServiceCredentials", "profiles"],
        value: [
          {
            id: "qa-gitlab-audit",
            provider: "gitlab",
            instance: "corp",
            label: "QA GitLab",
            enabled: false,
            resources: { projects: ["demo/repository"] },
          },
        ],
      },
    ]);
  });
});
