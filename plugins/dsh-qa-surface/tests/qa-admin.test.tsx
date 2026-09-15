// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    fireEvent.click(screen.getByText("Общие возможности"));
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
    fireEvent.click(await screen.findByText("Общие возможности"));
    fireEvent.click(screen.getByText("При активации навыка"));
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
    fireEvent.click(await screen.findByText("Навыки"));
    await waitFor(() =>
      expect(screen.getByText("browser-research")).toBeTruthy(),
    );
    expect(screen.getByText("Аналитик")).toBeTruthy();
    expect(screen.getByText("Заблокирован")).toBeTruthy();

    fireEvent.click(screen.getByText("Изменить →"));
    await waitFor(() => expect(screen.getByText("browser_open")).toBeTruthy());
    expect(screen.getByText("Нет в реестре")).toBeTruthy();

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
