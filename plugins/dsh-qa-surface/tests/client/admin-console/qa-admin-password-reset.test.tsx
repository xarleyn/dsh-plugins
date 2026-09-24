// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";
import type { QaPasswordResetRequest } from "../../../src/types.js";

/**
 * The forgotten-password queue on the users page. It has to appear while
 * somebody is locked out and stay out of the way otherwise: answering a row
 * ends every session of that account, so it is a deliberate act, not chrome.
 */

const REQUEST: QaPasswordResetRequest = {
  userId: "u1",
  email: "alice@example.com",
  displayName: "alice",
  requestedAt: "2026-09-21T09:00:00.000Z",
  lastRequestedAt: "2026-09-21T09:10:00.000Z",
  requestCount: 2,
  disabled: false,
};

describe("admin password reset queue", () => {
  it("stays out of the page while nobody is waiting", async () => {
    renderConsole(adminApi(), "/qa/admin/users");
    await screen.findByRole("heading", { name: "Пользователи" });
    expect(screen.queryByText("Заявки на сброс пароля")).toBeNull();
  });

  it("lists a waiting account and answers it with the typed password", async () => {
    let pending: readonly QaPasswordResetRequest[] = [REQUEST];
    const api = adminApi({
      passwordResetRequests: vi.fn(async () => ({
        ok: true as const,
        value: pending,
      })),
      resetPassword: vi.fn(async (_token, userId, _password) => {
        pending = [];
        return {
          ok: true as const,
          value: {
            user: {
              id: userId,
              email: "alice@example.com",
              displayName: "alice",
              fullName: "",
              role: "user" as const,
              disabled: false,
              createdAt: "2026-09-21T08:00:00.000Z",
              lastLoginAt: null,
              access: {
                allowedSubroles: ["general"],
                defaultSubrole: "general",
              },
              conversations: 0,
              feedbackGiven: 0,
            },
            effective: [],
            activity: {
              conversations: 0,
              messages: null,
              positiveRatings: 0,
              negativeRatings: 0,
            },
          },
        };
      }),
    });
    renderConsole(api, "/qa/admin/users");
    await screen.findByText("Заявки на сброс пароля");
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    // A repeated request is visible as a count, not as a second identical row.
    expect(screen.getByText("2")).toBeTruthy();

    // A password shorter than the Host's floor is refused before any call.
    fireEvent.click(screen.getByText("Сбросить"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("8 символов");
    });
    expect(api.resetPassword).not.toHaveBeenCalled();

    const field = screen.getByPlaceholderText("не короче 8 символов");
    fireEvent.change(field, { target: { value: "password-2" } });
    fireEvent.click(screen.getByText("Сбросить"));
    await waitFor(() => {
      expect(api.resetPassword).toHaveBeenCalledWith(
        "token",
        "u1",
        "password-2",
      );
    });
    // The queue is re-read after the answer, and the answered row is gone.
    await waitFor(() => {
      expect(screen.queryByText("Заявки на сброс пароля")).toBeNull();
    });
  });
});
