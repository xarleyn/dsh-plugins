// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFINITION, ok, renderPage } from "./client-page.helpers.js";

describe("client page: list", () => {
  it("renders the loaded domains with their counts", async () => {
    renderPage();
    expect(await screen.findByText("Payments")).toBeTruthy();
    expect(screen.getByText(/1 primary paths/)).toBeTruthy();
  });

  it("shows an explicit empty state", async () => {
    renderPage({ listDomains: () => Promise.resolve(ok({ domains: [] })) });
    expect(await screen.findByText(/No domains yet/u)).toBeTruthy();
  });

  it("surfaces a refused list request with its code", async () => {
    renderPage({
      listDomains: () =>
        Promise.resolve({
          ok: false,
          code: "STORAGE_UNAVAILABLE",
          message: "storage is closed",
        }),
    });
    expect(
      await screen.findByText(/STORAGE_UNAVAILABLE: storage is closed/u),
    ).toBeTruthy();
  });

  it("toggles a domain through the list action", async () => {
    const setDomainEnabled = vi.fn(() =>
      Promise.resolve(ok({ domain: DEFINITION })),
    );
    renderPage({ setDomainEnabled });
    const toggle = await screen.findByText("Disable");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setDomainEnabled).toHaveBeenCalledWith("payments", false);
    });
  });
});
