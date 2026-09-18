// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QaAdmin } from "../src/client/admin/QaAdmin.js";
import type { QaAccessApi } from "../src/client/types.js";

function api() {
  const snapshot = {
    config: {
      version: 1 as const,
      common: {
        tools: { always: ["search"], skillGrantable: ["browser_open"] },
        skills: [],
      },
      subroles: [
        {
          id: "analyst",
          name: "Аналитик",
          description: "Исследования",
          enabled: true,
          capabilities: {
            tools: { always: ["analytics"], skillGrantable: [] },
            skills: [],
          },
        },
        {
          id: "developer",
          name: "Разработчик",
          enabled: true,
          capabilities: {
            tools: { always: [], skillGrantable: [] },
            skills: [],
          },
        },
      ],
      skillOverrides: [],
    },
    systemRequired: {
      tools: { always: [], skillGrantable: [] },
      skills: [],
    },
    catalog: [
      {
        type: "tool" as const,
        id: "search",
        title: "search",
        source: { kind: "core" as const },
        status: "available" as const,
      },
      {
        type: "tool" as const,
        id: "analytics",
        title: "analytics",
        source: { kind: "plugin" as const, name: "analytics" },
        status: "available" as const,
      },
      {
        type: "tool" as const,
        id: "browser_open",
        title: "browser_open",
        source: { kind: "plugin" as const, name: "browser-use" },
        status: "available" as const,
      },
      {
        type: "skill" as const,
        id: "browser-research",
        title: "browser-research",
        source: { kind: "filesystem" as const, name: "skill-filesystem" },
        status: "available" as const,
      },
    ],
    skills: [
      {
        name: "browser-research",
        description: "Research websites with a browser",
        source: { kind: "filesystem" as const, name: "skill-filesystem" },
        status: "available" as const,
        descriptor: {
          name: "browser-research",
          audience: { type: "subroles" as const, include: ["analyst"] },
          requiredTools: ["browser_open"],
          requireAll: true,
          lifecycle: "session" as const,
          schemaVersion: 1,
          declared: true,
          warnings: [] as readonly string[],
        },
        visibleTo: ["analyst"],
        disabled: false,
        forceCommon: false,
        overridden: false,
        health: "blocked" as const,
        tools: [
          {
            id: "browser_open",
            installed: false,
            grantableBy: [] as readonly string[],
            blockedFor: ["analyst"],
          },
        ],
        roles: [
          {
            roleId: "analyst",
            visible: true,
            declared: true,
            addedByAdmin: false,
            removedByAdmin: false,
            disabled: false,
            grantableTools: [] as readonly string[],
            unavailableTools: ["browser_open"],
          },
          {
            roleId: "developer",
            visible: false,
            declared: false,
            addedByAdmin: false,
            removedByAdmin: false,
            disabled: false,
            grantableTools: [] as readonly string[],
            unavailableTools: ["browser_open"],
          },
        ],
      },
    ],
    users: [],
    audit: [],
  };
  const updateSkillOverride = vi.fn(async (_token: string, input: unknown) => ({
    ok: true as const,
    value: [input],
  }));
  const value = {
    current: vi.fn(),
    session: vi.fn(),
    admin: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    createSubrole: vi.fn(),
    updateSubrole: vi.fn(),
    deleteSubrole: vi.fn(),
    updateCommon: vi.fn(async (_token: string, input: unknown) => ({
      ok: true as const,
      value: input,
    })),
    updateAssignment: vi.fn(),
    updateSkillOverride,
    skillActivations: vi.fn(),
  } as unknown as QaAccessApi;
  return { value, updateSkillOverride };
}

describe("QA administration", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/qa/admin/access/subroles");
  });

  it("renders roles and the separate common capability editor", async () => {
    const { value } = api();
    render(
      <QaAdmin
        api={value}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    expect(await screen.findByText("Аналитик")).toBeTruthy();
    expect(screen.getByText("1 инструментов")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Общие возможности" }));
    await waitFor(() => expect(screen.getByText("search")).toBeTruthy());
    expect(
      (screen.getByRole("checkbox", { name: /search/u }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("splits the tool buckets in the common editor", async () => {
    const { value } = api();
    render(
      <QaAdmin
        api={value}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Общие возможности" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Доступны через навыки" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("checkbox", {
            name: /browser_open/u,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });

  it("offers a withdrawal bucket that beats every grant", async () => {
    const { value } = api();
    render(
      <QaAdmin
        api={value}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    // The role editor: a third bucket next to the two grants, because a pinned
    // system tool can only be taken away through a denial.
    await screen.findByText("Аналитик");
    fireEvent.click(screen.getAllByText("Изменить →")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    expect(screen.getByRole("heading", { name: "Запрещённые" })).toBeTruthy();
    expect(screen.getByText(/Запрет сильнее/u)).toBeTruthy();

    // The Common editor carries the same bucket, so one denial can cover every
    // profile at once.
    fireEvent.click(screen.getByRole("button", { name: "← Саброли" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Общие возможности" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Запрещённые" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("checkbox", { name: /search/u }) as HTMLInputElement)
          .checked,
      ).toBe(false),
    );
  });

  it("uses administrator-facing names for role tool buckets and grants", async () => {
    const { value } = api();
    render(
      <QaAdmin
        api={value}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    expect(await screen.findByText("Аналитик")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Изменить →")[0]!);

    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    expect(
      screen.getByRole("heading", { name: "Всегда доступны" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Доступны через навыки" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/не показываются агенту по умолчанию/u),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Навыки" }));
    expect(screen.getByText("Объявлены навыками")).toBeTruthy();
    expect(
      screen.getAllByText("Выдаёт при активации: browser_open"),
    ).not.toHaveLength(0);
    expect(screen.getByText("Объявлено навыком")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Фактический доступ" }));
    expect(
      screen.getByRole("heading", { name: "Всегда доступны" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Доступны через навыки" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Сейчас не используется ни одним назначенным навыком"),
    ).toBeTruthy();
  });

  it("lists skills with health and writes an audience override", async () => {
    const { value, updateSkillOverride } = api();
    render(
      <QaAdmin
        api={value}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Навыки" }));
    await waitFor(() =>
      expect(screen.getByText("browser-research")).toBeTruthy(),
    );
    expect(screen.getByText("Аналитик")).toBeTruthy();
    expect(screen.getByText("Заблокирован")).toBeTruthy();

    fireEvent.click(screen.getByText("Изменить →"));
    await waitFor(() => expect(screen.getByText("browser_open")).toBeTruthy());
    expect(screen.getByText("Нет в реестре")).toBeTruthy();
    // The tool is beyond every visible role's ceiling, so the editor reports
    // the collapsed verdict instead of listing the same roles per row.
    expect(screen.getByText("Недоступен ни одной роли")).toBeTruthy();
    expect(screen.queryByText(/Недоступен: /u)).toBeNull();

    // Grant the skill to a second role; the declared audience stays untouched.
    fireEvent.click(screen.getByRole("checkbox", { name: /Разработчик/u }));
    fireEvent.click(screen.getByText("Сохранить"));
    await waitFor(() => expect(updateSkillOverride).toHaveBeenCalled());
    expect(updateSkillOverride.mock.calls[0]?.[1]).toEqual({
      skillName: "browser-research",
      addToSubroles: ["developer"],
    });
  });
});
