// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";
import type { QaAdminUserDetail } from "../src/types.js";

/**
 * The user detail card. Its defining constraint is the cost of its payload:
 * reading the account's conversations on the Harness costs a full persistence
 * listing per log, so the card answers from the stores alone and a write must
 * not pay for a second read of anything.
 */

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
  // The subrole list is the card's only checkbox group; the access mock
  // enables exactly one profile.
  return screen.getByRole("checkbox") as HTMLInputElement;
}

describe("admin user detail card", () => {
  it("reports the message count as unknown instead of reading the logs", async () => {
    const user = vi.fn(async () => ({ ok: true as const, value: detail() }));
    renderConsole(adminApi({ user }), "/qa/admin/users/u1");

    expect(await screen.findByText(/alice@example.com/u)).toBeTruthy();
    expect(user).toHaveBeenCalledTimes(1);
    const messages = screen.getByText("Сообщения").nextElementSibling;
    expect(messages?.textContent).toBe("—");
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

    await screen.findByText(/alice@example.com/u);
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

    await screen.findByText(/alice@example.com/u);
    fireEvent.click(checkbox());

    expect(
      await screen.findByText(/У вашей роли нет прав на это действие\./u),
    ).toBeTruthy();
    expect(checkbox().checked).toBe(false);
    expect(user).toHaveBeenCalledTimes(1);
  });
});
