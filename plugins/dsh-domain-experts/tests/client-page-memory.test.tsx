// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ok, renderPage } from "./client-page.helpers.js";

describe("client page: memory and test", () => {
  it("inspects memory from the editor", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Memory" }));
    fireEvent.click(screen.getByText("Inspect memory"));
    expect(
      await screen.findByText(/Settlement closes at 14:00./u),
    ).toBeTruthy();
  });

  it("runs a test and shows the answer", async () => {
    const testExpert = vi.fn(() =>
      Promise.resolve(
        ok({
          result: {
            summary: "The batch aborts.",
            status: "completed",
            findings: [],
          },
        }),
      ),
    );
    renderPage({ testExpert });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Test" }));
    fireEvent.click(screen.getByText("Run test"));
    await waitFor(() => {
      expect(testExpert).toHaveBeenCalledWith(
        "payments",
        expect.any(String),
        "session-1",
      );
    });
    expect(await screen.findByText(/The batch aborts./u)).toBeTruthy();
  });

  it("surfaces a refused test run", async () => {
    renderPage({
      testExpert: () =>
        Promise.resolve({
          ok: false,
          code: "TASK_REJECTED",
          message: "no live session",
        }),
    });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Test" }));
    fireEvent.click(screen.getByText("Run test"));
    expect(
      await screen.findByText(/TASK_REJECTED: no live session/u),
    ).toBeTruthy();
  });
});
