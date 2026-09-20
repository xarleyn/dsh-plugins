// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ok, renderPage } from "./client-page.helpers.js";

/**
 * The list and the editor share one pane, so the two controls that used to be
 * implicit — open, and come back — are the ones these tests pin: a domain that
 * can only be disabled reads as a domain that cannot be edited.
 */
describe("client page: list and editor navigation", () => {
  it("opens the editor in place of the list", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Payments" }),
    );
    expect(await screen.findByText("Edit Payments")).toBeTruthy();
    expect(screen.queryByText(/1 primary paths/u)).toBeNull();
    expect(screen.getByRole("button", { name: /All domains/u })).toBeTruthy();
  });

  it("returns to the list from the editor", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Payments" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /All domains/u }),
    );
    expect(await screen.findByText(/1 primary paths/u)).toBeTruthy();
  });

  it("keeps the editor open when the discard is refused", async () => {
    const confirm = stubConfirm(false);
    try {
      renderPage();
      fireEvent.click(
        await screen.findByRole("button", { name: "Edit Payments" }),
      );
      fireEvent.click(await screen.findByRole("tab", { name: "General" }));
      fireEvent.change(screen.getByDisplayValue("Payments"), {
        target: { value: "Payments v2" },
      });
      fireEvent.click(
        await screen.findByRole("button", { name: /All domains/u }),
      );
      await waitFor(() => {
        expect(confirm).toHaveBeenCalledWith(
          expect.stringContaining("Discard unsaved changes"),
        );
      });
      expect(screen.queryByText(/1 primary paths/u)).toBeNull();
      expect(screen.getByText("Edit Payments v2")).toBeTruthy();
    } finally {
      confirm.mockRestore();
    }
  });

  it("leaves without asking while nothing was typed", async () => {
    const confirm = stubConfirm(true);
    try {
      renderPage();
      fireEvent.click(
        await screen.findByRole("button", { name: "Edit Payments" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: /All domains/u }),
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(await screen.findByText(/1 primary paths/u)).toBeTruthy();
    } finally {
      confirm.mockRestore();
    }
  });

  it("reports a domain that disappeared on the page, not nowhere", async () => {
    renderPage({ getDomain: () => Promise.resolve(ok({ domain: null })) });
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Payments" }),
    );
    expect(
      await screen.findByText("The domain no longer exists."),
    ).toBeTruthy();
    expect(screen.getByText(/1 primary paths/u)).toBeTruthy();
  });
});

/** jsdom ships `window.confirm` as an unimplemented stub, so it is replaced. */
function stubConfirm(returns: boolean) {
  return vi.spyOn(window, "confirm").mockImplementation(() => returns);
}
