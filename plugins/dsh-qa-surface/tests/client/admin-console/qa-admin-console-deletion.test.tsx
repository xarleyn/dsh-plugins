// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { adminApi, renderConsole } from "./qa-admin-console.helpers.js";

describe("conversation deletion", () => {
  it("removes the conversation from its own page, after a confirmation", async () => {
    const deleteConversation = vi.fn(
      async (_token: string, conversationId: string) => ({
        ok: true as const,
        value: { conversationId, sessions: [conversationId], qualityRows: 2 },
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderConsole(
        adminApi({ deleteConversation }),
        "/qa/admin/conversations/session-alice",
      );

      fireEvent.click(await screen.findByText("Удалить разговор"));

      await waitFor(() => expect(deleteConversation).toHaveBeenCalledTimes(1));
      expect(deleteConversation.mock.calls[0]).toEqual([
        "token",
        "session-alice",
      ]);
      // The console leaves the page it just emptied.
      await waitFor(() =>
        expect(window.location.pathname).toBe("/qa/admin/conversations"),
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("keeps the conversation when the confirmation is declined", async () => {
    const deleteConversation = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderConsole(
        adminApi({ deleteConversation }),
        "/qa/admin/conversations/session-alice",
      );

      fireEvent.click(await screen.findByText("Удалить разговор"));

      expect(deleteConversation).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(
        "/qa/admin/conversations/session-alice",
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("reports a refusal instead of leaving the page", async () => {
    const api = adminApi({
      deleteConversation: vi.fn(async () => ({
        ok: false as const,
        error: new Error("reason: conversation-live"),
      })),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderConsole(api, "/qa/admin/conversations/session-alice");

      fireEvent.click(await screen.findByText("Удалить разговор"));

      expect(
        await screen.findByText(/Разговор открыт на стенде прямо сейчас/u),
      ).toBeTruthy();
      expect(window.location.pathname).toBe(
        "/qa/admin/conversations/session-alice",
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("offers no deletion to a reviewer", async () => {
    renderConsole(
      adminApi(),
      "/qa/admin/conversations/session-alice",
      "reviewer",
    );

    expect(await screen.findByText("Сделай отчёт по релизу")).toBeTruthy();
    expect(screen.queryByText("Удалить разговор")).toBeNull();
  });
});
