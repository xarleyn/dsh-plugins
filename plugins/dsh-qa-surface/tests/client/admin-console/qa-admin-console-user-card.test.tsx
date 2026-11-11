// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
