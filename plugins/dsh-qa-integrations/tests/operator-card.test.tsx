// @vitest-environment jsdom

/**
 * The operator card: it renders the deployment configuration from the bound
 * settings scope, writes every edit as one path-addressed mutation, and
 * clears an override back to the composition layer. The namespace is the
 * plugin's configuration source, so a committed write is the deployment
 * change — the card adds no persistence of its own.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { OperatorCard } from "../src/client/operator-card.js";

/** The slot props the Host supplies are outside this test's concern. */
const Card = OperatorCard as unknown as (props: {
  scope: unknown;
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
}): { scope: never; stub: ScopeStub } {
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
    scope: scope as never,
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
  const { scope, stub } = scopeStub(initial);
  render(<Card scope={scope} />);
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
 * The `<details>` block one provider owns, found by its section title — one
 * pass over the eight sections instead of a name lookup over the thousand nodes
 * of the whole card. Every knob belongs to one provider anyway.
 */
function sectionOf(title: string): HTMLElement {
  const sections = [
    ...document.querySelectorAll<HTMLElement>(".qai-op__section"),
  ].filter(
    (section) =>
      captionOf(section.querySelector(".qai-op__section-title") ?? section) ===
      title,
  );
  expect(sections, `sections titled ${title}`).toHaveLength(1);
  return sections[0] as HTMLElement;
}

/**
 * The control a caption inside `scope` is bound to — what `getByLabelText`
 * answers, taken from the label's side rather than the control's. The library
 * asks every labelable element of the scope for its `labels`, and jsdom answers
 * that by scanning all two hundred `<label>` elements of this card once per
 * control: 40–150 ms for the first lookup of a provider, whatever subtree the
 * query was scoped to. A `<label>` already knows the control it binds — that is
 * what a click on the caption uses — so one walk of the captions says the same
 * thing for a fraction of a millisecond. What `get` adds on top is kept: a
 * caption that binds nothing, or binds two controls, fails here.
 */
function labelledControl(
  scope: HTMLElement,
  caption: string | RegExp,
): HTMLElement {
  const controls = new Set<HTMLElement | null>();
  for (const label of scope.querySelectorAll("label")) {
    const text = captionOf(label);
    const bound =
      caption instanceof RegExp ? caption.test(text) : text === caption;
    if (bound) controls.add((label as HTMLLabelElement).control);
  }
  const bound = [...controls].filter(
    (control): control is HTMLElement => control !== null,
  );
  expect(bound, `controls bound to ${caption}`).toHaveLength(1);
  return bound[0] as HTMLElement;
}

/**
 * The `<button>` captioned `caption`. `getByRole("button", {name})` computes the
 * accessible name of every button of the mounted card before it answers, which
 * costs a quarter of a second here. A button that carries no `aria-label` is
 * named by its contents, so comparing contents says the same thing; the shell's
 * header button is named by `aria-label` and stays a role query in `expand`.
 */
function buttonWithCaption(caption: string): HTMLElement {
  const hits = [...document.querySelectorAll("button")].filter(
    (button) => captionOf(button) === caption,
  );
  expect(hits, `buttons captioned ${caption}`).toHaveLength(1);
  return hits[0] as HTMLElement;
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
      <Card scope={scopeStub({ status: "unavailable" }).scope} />,
    );
    // The card renders null while the scope reports the namespace absent.
    expect(container.childElementCount).toBe(0);
  });

  it("renders the deployment configuration sections", () => {
    renderCard({ value: RESOLVED });
    expand();
    expect(screen.getByText("Общие")).toBeDefined();
    expect(screen.getByText("Bitrix24")).toBeDefined();
    expect(screen.getByText("GitLab")).toBeDefined();
    expect(screen.getByText("TeamCity")).toBeDefined();
    expect(screen.getByText("Сервисные доступы")).toBeDefined();
    // The badge names the layer state: nothing overridden yet.
    expect(screen.getByText("по умолчанию")).toBeDefined();
    // The general section mounts open and the disabled plugin shows it.
    expect(
      (
        labelledControl(
          sectionOf("Общие"),
          /Плагин включён/u,
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("summarises each collapsed provider in its header", () => {
    renderCard({ value: RESOLVED });
    expand();
    // GitLab: on, one instance, all seven capabilities on by default.
    expect(
      screen.getByText("включён · 1 инстанс · доступно 7 из 7"),
    ).toBeDefined();
    // Bitrix24 counts the deny-listed write tool as off.
    expect(screen.getByText("включён · доступно 8 из 9")).toBeDefined();
  });

  it("groups a provider into labelled blocks with the knobs folded away", () => {
    renderCard({ value: RESOLVED });
    expand();
    fireEvent.click(screen.getByText("GitLab"));
    const section = screen
      .getByText("Инстансы GitLab")
      .closest(".qai-op__section") as HTMLElement;
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
    expect(section.querySelector(".qai-op__group--checks")).toBeTruthy();
    expect(section.querySelector(".qai-op__group--wide")).toBeTruthy();
    // The numeric knobs stay folded until someone asks for them.
    const limits = section.querySelector(
      ".qai-op__group--limits",
    ) as HTMLDetailsElement;
    expect(limits.open).toBe(false);
    fireEvent.click(limits.querySelector("summary") as HTMLElement);
    expect(limits.open).toBe(true);
    expect(
      (labelledControl(limits, "Потолок файла, байт") as HTMLInputElement)
        .value,
    ).toBe("131072");
  });

  it("keeps every deployment knob reachable after the regrouping", () => {
    renderCard({ value: RESOLVED });
    expand();
    for (const provider of [
      "Confluence",
      "GitLab",
      "TeamCity",
      "Jira",
      "Test IT",
      "Weblate",
    ]) {
      fireEvent.click(
        sectionOf(provider).querySelector(
          ".qai-op__section-title",
        ) as HTMLElement,
      );
    }
    // One representative of each kind, in each provider that has it. The
    // captions are read in one pass: six name lookups over the whole card were
    // most of what this case used to cost.
    const captions = [...document.querySelectorAll("label")].map(captionOf);
    for (const label of [
      "Инстансы GitLab",
      "Сайты Confluence",
      "Адрес сервера TeamCity",
      "Сайты Jira Cloud",
      "Инсталляции Test IT",
      "Инстансы Weblate",
    ]) {
      expect(
        captions.filter((caption) => caption === label),
        `connection editor of ${label}`,
      ).toHaveLength(1);
    }
    // A capability of each provider, read through the checklist that owns it —
    // which is what "its deployment knobs" means here.
    for (const [provider, capability] of [
      ["Confluence", "Версии: чтение"],
      ["GitLab", "CI: чтение"],
      ["TeamCity", "Агенты: чтение"],
      ["Jira", "Переходы: чтение"],
      ["Test IT", "Автотесты: чтение"],
      ["Weblate", "Скриншоты: чтение"],
    ] as const) {
      const checks = sectionOf(provider).querySelector(
        ".qai-op__group--checks",
      ) as HTMLElement;
      expect(labelledControl(checks, capability)).toBeDefined();
    }
  });

  it("writes a capability toggle as one path-addressed set", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    // The Bitrix24 section is collapsed until opened.
    fireEvent.click(screen.getByText("Bitrix24"));
    const crm = labelledControl(
      sectionOf("Bitrix24"),
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
    fireEvent.click(labelledControl(sectionOf("Общие"), /Плагин включён/u));
    expect(stub.writes).toEqual([
      { op: "set", path: ["enabled"], value: true },
    ]);
  });

  it("marks overridden fields and clears the whole override layer", () => {
    const stub = renderCard({
      value: RESOLVED,
      user: { teamcity: { serverUrl: "https://teamcity.example.corp" } },
    });
    expect(screen.getByText("переопределено: 1")).toBeDefined();
    expand();
    fireEvent.click(screen.getByText("Сбросить переопределения (1)"));
    expect(stub.writes).toEqual([{ op: "unset", path: ["teamcity"] }]);
  });

  it("shows read-only copy when the Host document takes no writes", () => {
    renderCard({ value: RESOLVED, writable: false });
    expand();
    // The anchored copy is the read-only banner; the list editors say the same
    // words about a row they could not commit, so the query stays specific.
    expect(
      screen.getByText(/^Хост не принимает правки из этого браузера/u),
    ).toBeDefined();
    const toggle = labelledControl(
      sectionOf("Общие"),
      /Плагин включён/u,
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
    const section = screen
      .getByText("Сайты Jira Cloud")
      .closest(".qai-op__section") as HTMLElement;
    const select = section.querySelector("select") as HTMLSelectElement;
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
    const section = screen
      .getByText("Сайты Confluence")
      .closest(".qai-op__section") as HTMLElement;
    const select = section.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("server");
    const row = section.querySelector(".qai-op__instance") as HTMLElement;
    const label = row.querySelectorAll("input")[1] as HTMLInputElement;
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
    for (const provider of ["Confluence", "GitLab", "Jira", "Test IT"]) {
      fireEvent.click(screen.getByText(provider));
    }
    const selectsIn = (label: string): number => {
      const section = screen
        .getByText(label)
        .closest(".qai-op__section") as HTMLElement;
      return section.querySelectorAll("select").length;
    };
    // One control per row of the two providers that distinguish a deployment…
    expect(selectsIn("Сайты Confluence")).toBe(1);
    expect(selectsIn("Сайты Jira Cloud")).toBe(1);
    // …and none at all for a provider that has no such distinction.
    expect(selectsIn("Инстансы GitLab")).toBe(0);
  });

  it("starts a row the operator adds on the Cloud default", () => {
    const stub = renderCard({
      value: { ...RESOLVED, jira: { enabled: true, sites: [] } },
    });
    expand();
    const section = screen
      .getByText("Сайты Jira Cloud")
      .closest(".qai-op__section") as HTMLElement;
    // The add button sits in the span next to the row list; the field-alias
    // record editor further down carries one of its own.
    const add = section.querySelector(
      ".qai-op__instances ~ span button",
    ) as HTMLButtonElement;
    fireEvent.click(add);
    const select = section.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("cloud");
    // An unfinished row stays a local draft, so nothing is committed yet.
    expect(stub.writes).toEqual([]);
  });

  it("keeps an unfinished instance draft local when the stored row is removed", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    const section = screen
      .getByText("Инстансы GitLab")
      .closest(".qai-op__section") as HTMLElement;
    const add = section.querySelector(
      ".qai-op__instances ~ span button",
    ) as HTMLButtonElement;
    fireEvent.click(add);
    expect(section.querySelectorAll(".qai-op__instance")).toHaveLength(2);
    stub.writes.splice(0);

    const removeStored = section.querySelector(
      ".qai-op__instance .qai-op__row-remove",
    ) as HTMLButtonElement;
    fireEvent.click(removeStored);

    expect(stub.writes).toEqual([
      { op: "unset", path: ["gitlab", "instances"] },
    ]);
    expect(section.querySelectorAll(".qai-op__instance")).toHaveLength(1);
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
    fireEvent.click(screen.getByText("Сервисные доступы"));
    fireEvent.click(buttonWithCaption("добавить профиль"));

    expect(document.querySelectorAll(".qai-op__profile")).toHaveLength(1);
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
    fireEvent.click(screen.getByText("Сервисные доступы"));
    const id = document.querySelector(
      ".qai-op__profile input[type='text']",
    ) as HTMLInputElement;

    fireEvent.change(id, { target: { value: "qa-gitlab-audit" } });
    expect(id.value).toBe("qa-gitlab-audit");
    expect(stub.writes).toEqual([]);
    fireEvent.click(
      document.querySelector(
        ".qai-op__profile input[type='checkbox']",
      ) as HTMLInputElement,
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
