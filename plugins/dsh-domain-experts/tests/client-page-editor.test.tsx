// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFINITION, ok, renderPage } from "./client-page.helpers.js";

describe("client page: editor", () => {
  it("opens a domain and shows the resolved scope with enforcement labels", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Payments"));
    expect(await screen.findByText(/Resolved scope — Payments/u)).toBeTruthy();
    expect(screen.getAllByText("enforced").length).toBeGreaterThan(0);
    expect(screen.getAllByText("advisory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("code_worker").length).toBeGreaterThan(0);
  });

  it("moves through the editor tabs", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Persona" }));
    expect(await screen.findByText(/Composed persona/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Delegation" }));
    expect(screen.getByText(/Cross-domain policy/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Test" }));
    expect(screen.getByText(/Run test/u)).toBeTruthy();
  });

  it("renders a validation issue reported by the host", async () => {
    renderPage({
      inspectDraft: () =>
        Promise.resolve(
          ok({
            ok: true,
            code: "",
            message: "",
            definition: DEFINITION,
            issues: [
              {
                severity: "error" as const,
                field: "scope.filesystem.primary",
                message:
                  'Path "/etc/passwd" is invalid: absolute paths are outside the workspace.',
              },
            ],
          }),
        ),
    });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "Resources" }));
    const input = await screen.findByPlaceholderText("services/payments/**");
    fireEvent.change(input, { target: { value: "/etc/passwd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByText(/absolute paths are outside the workspace/u),
      ).toBeTruthy();
    });
  });

  it("creates a domain from an id in the header", async () => {
    const draftDomain = vi.fn(() =>
      Promise.resolve(ok({ domain: DEFINITION })),
    );
    renderPage({ draftDomain });
    fireEvent.change(await screen.findByPlaceholderText("new-domain-id"), {
      target: { value: "payments" },
    });
    fireEvent.click(screen.getByText("Add domain"));
    await waitFor(() => {
      expect(draftDomain).toHaveBeenCalledWith("payments");
    });
    expect(await screen.findByText("New domain")).toBeTruthy();
  });

  it("saves an edited domain and reports success", async () => {
    const updateDomain = vi.fn(() =>
      Promise.resolve(ok({ domain: DEFINITION })),
    );
    renderPage({ updateDomain });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByRole("tab", { name: "General" }));
    fireEvent.change(screen.getByDisplayValue("Payments"), {
      target: { value: "Payments v2" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(updateDomain).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Changes saved.")).toBeTruthy();
  });

  it("reports a refused write instead of pretending it saved", async () => {
    renderPage({
      updateDomain: () =>
        Promise.resolve({
          ok: false,
          code: "DOMAIN_INVALID",
          message: "id is reserved",
        }),
    });
    fireEvent.click(await screen.findByText("Payments"));
    fireEvent.click(await screen.findByText("Save"));
    expect(
      await screen.findByText(/DOMAIN_INVALID: id is reserved/u),
    ).toBeTruthy();
  });
});
