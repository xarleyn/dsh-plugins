// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QaAdmin } from "../../../src/client/admin/QaAdmin.js";
import type { QaAccessApi } from "../../../src/client/types.js";

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
    updateSubrole: vi.fn(
      async (_token: string, _id: string, input: unknown) => ({
        ok: true as const,
        value: input,
      }),
    ),
    deleteSubrole: vi.fn(),
    updateCommon: vi.fn(async (_token: string, input: unknown) => ({
      ok: true as const,
      value: input,
    })),
    updateAssignment: vi.fn(),
    // The pairs the Host can serve, which is the only list a policy may be
    // written from: a pair nobody offers fails the first question of every chat
    // that policy opens.
    modelCatalog: vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          provider: "local",
          model: "small",
          label: "Small",
          reasoningEfforts: [],
        },
        {
          provider: "deepseek",
          model: "chat",
          label: "Chat",
          reasoningEfforts: ["low", "high"],
        },
      ],
    })),
    updateSkillOverride,
    skillActivations: vi.fn(),
  } as unknown as QaAccessApi;
  return {
    value,
    updateSkillOverride,
    updateSubrole: value.updateSubrole as ReturnType<typeof vi.fn>,
  };
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
    const card = (await screen.findAllByTestId("qa-admin-role-card"))[0]!;
    expect(
      within(card).getByRole("heading", { name: "Аналитик" }),
    ).toBeTruthy();
    expect(
      within(card).getByTestId("qa-admin-role-count-tools").textContent,
    ).toBe("1 инструментов");
    fireEvent.click(screen.getByRole("button", { name: "Общие возможности" }));
    await waitFor(() =>
      expect(
        screen.getAllByTestId("qa-admin-common-capabilities-item"),
      ).not.toHaveLength(0),
    );
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
    await screen.findAllByTestId("qa-admin-role-card");
    fireEvent.click(screen.getAllByTestId("qa-admin-role-edit")[0]!);
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

  it("writes a role's model pair out of the catalog the Host serves", async () => {
    const { value, updateSubrole } = api();
    render(
      <QaAdmin
        api={value}
        token="admin-token"
        routePath="/qa"
        onPreview={() => undefined}
      />,
    );
    await screen.findAllByTestId("qa-admin-role-card");
    fireEvent.click(screen.getAllByTestId("qa-admin-role-edit")[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Модель" }));
    const pair = (await screen.findByTestId(
      "qa-admin-role-model-pair",
    )) as HTMLSelectElement;
    // The operator chooses a pair; nothing outside the Host's own catalog can
    // be written, because such a policy fails inside the first chat it opens.
    expect(Array.from(pair.options).map((option) => option.value)).toEqual([
      "",
      "local/small",
      "deepseek/chat",
    ]);
    fireEvent.change(pair, { target: { value: "deepseek/chat" } });
    const effort = screen.getByTestId(
      "qa-admin-role-model-effort",
    ) as HTMLSelectElement;
    expect(Array.from(effort.options).map((option) => option.value)).toEqual([
      "",
      "low",
      "high",
    ]);
    fireEvent.click(screen.getByTestId("qa-admin-role-save"));
    await waitFor(() => expect(updateSubrole).toHaveBeenCalled());
    expect(
      (updateSubrole.mock.calls[0] as readonly unknown[])[2],
    ).toMatchObject({ model: { provider: "deepseek", model: "chat" } });
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
    expect(await screen.findAllByTestId("qa-admin-role-card")).not.toHaveLength(
      0,
    );
    fireEvent.click(screen.getAllByTestId("qa-admin-role-edit")[0]!);

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
    expect(
      screen.getByRole("heading", { name: "Объявлены навыками" }),
    ).toBeTruthy();
    expect(
      within(
        screen.getAllByTestId("qa-admin-role-declared-item")[0]!,
      ).getByTestId("qa-admin-role-declared-grants").textContent,
    ).toContain("Выдаёт при активации: browser_open");
    expect(screen.getByTestId("qa-admin-role-declared-mark").textContent).toBe(
      "Объявлено навыком",
    );

    fireEvent.click(screen.getByRole("button", { name: "Фактический доступ" }));
    expect(
      screen.getByRole("heading", { name: "Всегда доступны" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Доступны через навыки" }),
    ).toBeTruthy();
    expect(screen.getByTestId("qa-admin-role-effective-via").textContent).toBe(
      "Сейчас не используется ни одним назначенным навыком",
    );
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
    await screen.findByTestId("qa-admin-skill-row");
    expect(screen.getByTestId("qa-admin-skill-name").textContent).toContain(
      "browser-research",
    );
    expect(screen.getByTestId("qa-admin-skill-audience").textContent).toContain(
      "Аналитик",
    );
    expect(screen.getByTestId("qa-admin-skill-health").textContent).toBe(
      "Заблокирован",
    );

    fireEvent.click(screen.getByTestId("qa-admin-skill-edit"));
    await screen.findByTestId("qa-admin-skill-tool-id");
    expect(
      screen.getByTestId("qa-admin-skill-tool-uninstalled").textContent,
    ).toBe("Нет в реестре");
    // The tool is beyond every visible role's ceiling, so the editor reports
    // the collapsed verdict instead of listing the same roles per row.
    expect(
      screen.getByTestId("qa-admin-skill-tool-blocked-all").textContent,
    ).toBe("Недоступен ни одной роли");
    expect(
      screen.queryByTestId("qa-admin-skill-tool-blocked-roles"),
    ).toBeNull();

    // Grant the skill to a second role; the declared audience stays untouched.
    fireEvent.click(screen.getByRole("checkbox", { name: /Разработчик/u }));
    fireEvent.click(screen.getByTestId("qa-admin-skill-save"));
    await waitFor(() => expect(updateSkillOverride).toHaveBeenCalled());
    expect(updateSkillOverride.mock.calls[0]?.[1]).toEqual({
      skillName: "browser-research",
      addToSubroles: ["developer"],
    });
  });
});
