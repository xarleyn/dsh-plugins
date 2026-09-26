// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ok, renderPage } from "./client-page.helpers.js";

describe("client page: memory and test", () => {
  it("inspects memory from the editor", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByRole("tab", { name: "Memory" }));
    fireEvent.click(screen.getByTestId("domain-experts-editor-inspect-memory"));
    expect(
      (await screen.findByTestId("domain-experts-editor-memory-log"))
        .textContent,
    ).toContain("Settlement closes at 14:00.");
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
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByRole("tab", { name: "Test" }));
    fireEvent.click(screen.getByTestId("domain-experts-editor-test-run"));
    await waitFor(() => {
      expect(testExpert).toHaveBeenCalledWith(
        "payments",
        expect.any(String),
        "session-1",
      );
    });
    expect(
      (await screen.findByTestId("domain-experts-editor-test-summary"))
        .textContent,
    ).toContain("The batch aborts.");
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
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByRole("tab", { name: "Test" }));
    fireEvent.click(screen.getByTestId("domain-experts-editor-test-run"));
    expect(
      (await screen.findByTestId("domain-experts-editor-test-error"))
        .textContent,
    ).toContain("TASK_REJECTED: no live session");
  });
});
