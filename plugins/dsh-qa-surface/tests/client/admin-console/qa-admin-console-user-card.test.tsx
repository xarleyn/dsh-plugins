// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";
import type { QaAdminUserDetail } from "../../../src/types.js";

/**
 * The user detail card. Its defining constraint is the cost of its payload:
 * reading the account's conversations on the Harness costs a full persistence
 * listing per log, so the card answers from the stores alone and a write must
 * not pay for a second read of anything.
 */

/** The console mounts against a shared CI container; see the other page tests. */
const MOUNT_TIMEOUT = { timeout: 15_000 } as const;

function detail(overrides: Partial<QaAdminUserDetail> = {}): QaAdminUserDetail {
  return {
    user: {
      id: "u1",
      email: "alice@example.com",
      displayName: "alice",
      fullName: "",
      role: "admin",
      disabled: false,
      createdAt: "2026-09-19T07:33:44.739Z",
      lastLoginAt: "2026-09-19T08:40:48.610Z",
      access: { allowedSubroles: ["general"], defaultSubrole: "general" },
      conversations: 14,
      feedbackGiven: 0,
    },
    effective: [],
    activity: {
      conversations: 14,
      messages: null,
      positiveRatings: 0,
      negativeRatings: 0,
    },
    ...overrides,
  };
}

function checkbox(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: "Аналитик" }) as HTMLInputElement;
}

describe("admin user detail card", () => {
  it("closes the removed account and reports pending server cleanup", async () => {
    renderConsole(
      adminApi({
        user: async () => ({ ok: true, value: detail() }),
        deleteUser: async () => ({
          ok: false,
          error: new Error("reason: account-removal-pending"),
        }),
      }),
      "/qa/admin/users/u1",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Удалить аккаунт…" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Удалить аккаунт",
      }),
    );
    expect(
      await screen.findByText(/Сервер завершит обработку автоматически/u),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/qa/admin/users");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("preserves the current page when a dismissed removal finishes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const deleteUser = vi.fn(async () => {
      await pending;
      return { ok: true as const, value: 14 };
    });
    renderConsole(
      adminApi({
        user: async () => ({ ok: true, value: detail() }),
        deleteUser,
      }),
      "/qa/admin/users/u1",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Удалить аккаунт…" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Удалить аккаунт",
      }),
    );
    expect(deleteUser).toHaveBeenCalledOnce();
    act(() => {
      window.history.pushState(null, "", "/qa/admin/audit");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      finish();
      await pending;
    });
    expect(window.location.pathname).toBe("/qa/admin/audit");
  });

  it("keeps the dialog open on refusal and omits the history option for an empty account", async () => {
    const user = { ...detail().user, conversations: 0 };
    const deleteUser = vi.fn(async () => ({
      ok: false as const,
      error: new Error("reason: last-admin"),
    }));
    renderConsole(
      adminApi({
        user: async () => ({ ok: true, value: detail({ user }) }),
        deleteUser,
      }),
      "/qa/admin/users/u1",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Удалить аккаунт…" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("checkbox")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Удалить аккаунт" }));
    expect((await dialog.findByRole("alert")).textContent).toContain(
      "администратор",
    );
    expect(deleteUser.mock.calls).toEqual([["token", "u1", false, 0]]);
    fireEvent.click(dialog.getByRole("button", { name: "Отмена" }));
    expect(window.location.pathname).toBe("/qa/admin/users/u1");
  });
  it.each([false, true])(
    "deletes from the list or card with explicit history selection (%s)",
    async (purge) => {
      const value = detail();
      const deleteUser = vi.fn(async () => ({ ok: true as const, value: 14 }));
      const users = vi.fn(async () => {
        const items = deleteUser.mock.calls.length ? [] : [value.user];
        return {
          ok: true as const,
          value: { items, total: items.length, nextCursor: null },
        };
      });
      renderConsole(
        adminApi({
          users,
          deleteUser,
          user: async () => ({ ok: true, value }),
        }),
        purge ? "/qa/admin/users/u1" : "/qa/admin/users",
      );
      const open = await screen.findByRole("button", {
        name: /Удалить аккаунт/u,
      });
      fireEvent.click(open);
      let dialog = within(screen.getByRole("dialog"));
      fireEvent.click(dialog.getByRole("checkbox"));
      fireEvent.click(dialog.getByRole("button", { name: "Отмена" }));
      expect(deleteUser).not.toHaveBeenCalled();
      fireEvent.click(open);
      dialog = within(screen.getByRole("dialog"));
      const checkbox = dialog.getByRole("checkbox") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      if (purge) fireEvent.click(checkbox);
      fireEvent.click(
        dialog.getByRole("button", {
          name: purge ? "Удалить аккаунт и 14 разговоров" : "Удалить аккаунт",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(deleteUser.mock.calls).toEqual([["token", "u1", purge, 14]]);
      expect(window.location.pathname).toBe("/qa/admin/users");
      expect(await screen.findByText(/Аккаунт «alice» удалён/u)).toBeTruthy();
      expect(await screen.findByText("Никого не нашлось.")).toBeTruthy();
    },
  );
  it.each(["role", "slots", "model"] as const)(
    "preserves independent model grants and queue overrides when editing %s",
    async (field) => {
      const access = {
        allowedSubroles: ["general"],
        defaultSubrole: "general",
        model: { provider: "demo", model: "demo-model" },
        allowedModels: [{ provider: "local", model: "demo-alternative" }],
        maxActiveRequests: 2,
      };
      const value = detail({ user: { ...detail().user, access } });
      const user = vi.fn(async () => ({ ok: true as const, value }));
      const updateUser = vi.fn(
        async (_token: string, _id: string, _update: unknown) => ({
          ok: true as const,
          value,
        }),
      );
      renderConsole(adminApi({ user, updateUser }), "/qa/admin/users/u1");
      await screen.findByTestId("qa-admin-user-card", {}, MOUNT_TIMEOUT);
      if (field === "role") fireEvent.click(checkbox());
      else if (field === "slots")
        fireEvent.change(
          screen.getByTestId("qa-admin-user-queue-slots-select"),
          {
            target: { value: "inherit" },
          },
        );
      else
        fireEvent.change(
          await screen.findByTestId("qa-admin-user-model-pair"),
          { target: { value: "" } },
        );
      await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
      const { model, maxActiveRequests, ...rest } = access;
      expect(updateUser.mock.calls[0]?.[2]).toEqual({
        access: {
          ...rest,
          allowedSubroles:
            field === "role" ? ["general", "analyst"] : access.allowedSubroles,
          ...(field === "model" ? {} : { model }),
          ...(field === "slots" ? {} : { maxActiveRequests }),
        },
      });
    },
  );

  it("reports the message count as unknown instead of reading the logs", async () => {
    const user = vi.fn(async () => ({ ok: true as const, value: detail() }));
    renderConsole(adminApi({ user }), "/qa/admin/users/u1");

    expect(
      await screen.findByTestId("qa-admin-user-card", {}, MOUNT_TIMEOUT),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "alice",
        level: 1,
      }),
    ).toBeTruthy();
    expect(user).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("qa-admin-user-messages").textContent).toBe("—");
  });

  it("applies the update response directly, without a second read", async () => {
    const user = vi.fn(async () => ({ ok: true as const, value: detail() }));
    const updateUser = vi.fn(
      async (_token: string, _userId: string, _update: unknown) => ({
        ok: true as const,
        value: detail({
          user: {
            ...detail().user,
            access: {
              allowedSubroles: ["general", "analyst"],
              defaultSubrole: "general",
            },
          },
        }),
      }),
    );
    renderConsole(adminApi({ user, updateUser }), "/qa/admin/users/u1");

    await screen.findByTestId("qa-admin-user-card", {}, MOUNT_TIMEOUT);
    expect(checkbox().checked).toBe(false);

    fireEvent.click(checkbox());

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]?.[2]).toEqual({
      access: {
        allowedSubroles: ["general", "analyst"],
        defaultSubrole: "general",
      },
    });
    // The response is the fresh detail: the card adopts it on the spot and
    // never re-asks for the user it has just updated.
    await waitFor(() => expect(checkbox().checked).toBe(true));
    expect(user).toHaveBeenCalledTimes(1);
  });

  it("keeps the page and reports a refusal without touching the data", async () => {
    const user = vi.fn(async () => ({ ok: true as const, value: detail() }));
    const updateUser = vi.fn(async () => ({
      ok: false as const,
      error: new Error("reason: forbidden"),
    }));
    renderConsole(adminApi({ user, updateUser }), "/qa/admin/users/u1");

    await screen.findByTestId("qa-admin-user-card", {}, MOUNT_TIMEOUT);
    fireEvent.click(checkbox());

    expect(
      (await screen.findByTestId("qa-admin-user-error", {}, MOUNT_TIMEOUT))
        .textContent,
    ).toContain("У вашей роли нет прав на это действие.");
    expect(checkbox().checked).toBe(false);
    expect(user).toHaveBeenCalledTimes(1);
  });
});
