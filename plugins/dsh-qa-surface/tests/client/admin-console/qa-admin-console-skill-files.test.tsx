// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaAdminSkillScope, QaAdminUserRow } from "../../../src/types.js";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";

function row(overrides: Partial<QaAdminUserRow> = {}): QaAdminUserRow {
  return {
    id: "u1",
    email: "alice@example.com",
    displayName: "alice",
    fullName: "",
    role: "user",
    disabled: false,
    createdAt: "2026-09-19T07:33:44.739Z",
    lastLoginAt: null,
    access: { allowedSubroles: ["general"], defaultSubrole: "general" },
    conversations: 2,
    feedbackGiven: 0,
    ...overrides,
  };
}

const SHARED: QaAdminSkillScope = { kind: "shared" };

/** A console API with inspectable user and skill mocks. */
function rig(users: readonly QaAdminUserRow[]) {
  const listUsers = vi.fn(async () => ({
    ok: true as const,
    value: { items: users, nextCursor: null, total: users.length },
  }));
  const listSkills = vi.fn(
    async (_token: string, scope: QaAdminSkillScope) => ({
      ok: true as const,
      value: { scope, owner: null, skills: [], rootPath: "" },
    }),
  );
  return {
    api: adminApi({ users: listUsers, skills: listSkills }),
    listUsers,
    listSkills,
  };
}

/** The token every console in these tests is rendered with. */
const TOKEN = "token";

/**
 * The console's skill editor. What it must not do is grow a second editor:
 * the page picks a store and then mounts the same settings page a person sees
 * for their own skills.
 */
/**
 * The console mounts asynchronously, and the release runner is a shared
 * container: under that load the first render starves past Testing Library's
 * default 1s, which reads as a missing button rather than a slow machine. The
 * file runs in a fraction of a second locally.
 */
const MOUNT_TIMEOUT = { timeout: 15_000 } as const;

describe("admin console skill files", () => {
  it("opens on the shared store and mounts the shared catalog", async () => {
    const { api, listSkills } = rig([row()]);
    renderConsole(api, "/qa/admin/skills/editor");
    expect(
      await screen.findByRole(
        "heading",
        { name: "Редактор навыков" },
        MOUNT_TIMEOUT,
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        "У вас пока нет навыков.",
        undefined,
        MOUNT_TIMEOUT,
      ),
    ).toBeTruthy();
    expect(listSkills).toHaveBeenCalledWith(TOKEN, SHARED);
  });

  it("asks for a user before it opens a personal store", async () => {
    const { api, listSkills } = rig([row()]);
    renderConsole(api, "/qa/admin/skills/editor");
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Личные навыки пользователя" },
        MOUNT_TIMEOUT,
      ),
    );
    expect(
      screen.getByText(
        "Выберите пользователя, чтобы открыть его личные навыки.",
      ),
    ).toBeTruthy();
    // No store was opened, so no personal catalog was asked for.
    expect(listSkills).not.toHaveBeenCalledWith(TOKEN, {
      kind: "user",
      userId: "u1",
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "u1" },
    });
    await waitFor(() => {
      expect(listSkills).toHaveBeenCalledWith(TOKEN, {
        kind: "user",
        userId: "u1",
      });
    }, MOUNT_TIMEOUT);
  });

  it("names the owner and the directory an administrator is editing", async () => {
    const users = vi.fn(async () => ({
      ok: true as const,
      value: { items: [row()], nextCursor: null, total: 1 },
    }));
    const skills = vi.fn(async (_token: string, scope: QaAdminSkillScope) => ({
      ok: true as const,
      value: {
        scope,
        owner: {
          userId: "u1",
          email: "alice@example.com",
          displayName: "alice",
        },
        skills: [],
        rootPath: "D:\\workspace\\.qa-users\\u1\\.dsh\\skills",
      },
    }));
    renderConsole(adminApi({ users, skills }), "/qa/admin/skills/editor");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Личные навыки пользователя",
      }),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "u1" },
    });
    expect(await screen.findByText("Личное хранилище alice")).toBeTruthy();
    expect(
      screen.getByText("D:\\workspace\\.qa-users\\u1\\.dsh\\skills"),
    ).toBeTruthy();
  });

  it("shows the refusal and no editor when the role may not manage skills", async () => {
    const skills = vi.fn(async () => ({
      ok: false as const,
      error: new Error("QA accounts refused the request (reason: forbidden)"),
    }));
    renderConsole(adminApi({ skills }), "/qa/admin/skills/editor", "reviewer");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "У вашей роли нет прав на это действие.",
    );
    expect(screen.queryByRole("button", { name: "Создать навык" })).toBeNull();
  });

  it("keeps the section out of a reviewer's navigation", async () => {
    renderConsole(adminApi(), "/qa/admin/skills", "reviewer");
    expect(await screen.findByRole("heading", { name: "Навыки" })).toBeTruthy();
    expect(screen.queryByText("Редактор навыков")).toBeNull();
  });
});
