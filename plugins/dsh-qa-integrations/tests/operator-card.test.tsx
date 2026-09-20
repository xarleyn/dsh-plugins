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
      (screen.getByLabelText(/Плагин включён/u) as HTMLInputElement).checked,
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
      (screen.getByLabelText("Потолок файла, байт") as HTMLInputElement).value,
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
      fireEvent.click(screen.getByText(provider));
    }
    // One representative of each kind, in each provider that has it.
    for (const label of [
      "Инстансы GitLab",
      "Сайты Confluence",
      "Адрес сервера TeamCity",
      "Сайты Jira Cloud",
      "Инсталляции Test IT",
      "Инстансы Weblate",
    ]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    for (const label of [
      "CI: чтение",
      "Версии: чтение",
      "Агенты: чтение",
      "Переходы: чтение",
      "Автотесты: чтение",
      "Скриншоты: чтение",
    ]) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
  });

  it("writes a capability toggle as one path-addressed set", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    // The Bitrix24 section is collapsed until opened.
    fireEvent.click(screen.getByText("Bitrix24"));
    const crm = screen.getByLabelText("CRM: чтение") as HTMLInputElement;
    expect(crm.checked).toBe(true);
    fireEvent.click(crm);
    expect(stub.writes).toEqual([
      { op: "set", path: ["bitrix24", "crmRead"], value: false },
    ]);
  });

  it("enables the plugin from the always-open general section", () => {
    const stub = renderCard({ value: RESOLVED });
    expand();
    fireEvent.click(screen.getByLabelText(/Плагин включён/u));
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
    expect(
      screen.getByText(/Хост не принимает правки из этого браузера/u),
    ).toBeDefined();
    const toggle = screen.getByLabelText(/Плагин включён/u) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });
});
