// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFINITION, ok, renderPage } from "./client-page.helpers.js";

describe("client page: editor", () => {
  it("opens a domain and shows the resolved scope with enforcement labels", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    expect(
      (await screen.findByTestId("domain-experts-inspector-title")).textContent,
    ).toContain("Resolved scope — Payments");
    const enforcement = screen.getAllByTestId(
      "domain-experts-inspector-resource-enforcement",
    );
    expect(enforcement.map((chip) => chip.textContent)).toEqual([
      "enforced",
      "advisory",
    ]);
    expect(
      screen
        .getAllByTestId("domain-experts-inspector-resource-applied-by")
        .map((cell) => cell.textContent),
    ).toEqual(["code_worker", "—"]);
  });

  it("moves through the editor tabs", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByRole("tab", { name: "Persona" }));
    expect(
      (
        await screen.findByTestId(
          "domain-experts-editor-composed-persona-label",
        )
      ).textContent,
    ).toContain("Composed persona");
    fireEvent.click(screen.getByRole("tab", { name: "Delegation" }));
    expect(
      screen.getByTestId("domain-experts-editor-delegation-title").textContent,
    ).toContain("Cross-domain policy");
    fireEvent.click(screen.getByRole("tab", { name: "Test" }));
    expect(
      screen.getByTestId("domain-experts-editor-test-run").textContent,
    ).toBe("Run test");
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
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByRole("tab", { name: "Resources" }));
    const input = await screen.findByTestId(
      "domain-experts-editor-primary-paths-input",
    );
    fireEvent.change(input, { target: { value: "/etc/passwd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByTestId("domain-experts-editor-issue").textContent,
      ).toContain("absolute paths are outside the workspace");
    });
  });

  it("creates a domain from an id in the header", async () => {
    const draftDomain = vi.fn(() =>
      Promise.resolve(ok({ domain: DEFINITION })),
    );
    renderPage({ draftDomain });
    fireEvent.change(await screen.findByTestId("domain-experts-page-new-id"), {
      target: { value: "payments" },
    });
    fireEvent.click(screen.getByTestId("domain-experts-page-add-domain"));
    await waitFor(() => {
      expect(draftDomain).toHaveBeenCalledWith("payments");
    });
    expect(
      (await screen.findByTestId("domain-experts-editor-title")).textContent,
    ).toBe("New domain");
  });

  it("saves an edited domain and reports success", async () => {
    const updateDomain = vi.fn(() =>
      Promise.resolve(ok({ domain: DEFINITION })),
    );
    renderPage({ updateDomain });
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByRole("tab", { name: "General" }));
    const name = (await screen.findByTestId(
      "domain-experts-editor-name-input",
    )) as HTMLInputElement;
    expect(name.value).toBe("Payments");
    fireEvent.change(name, { target: { value: "Payments v2" } });
    fireEvent.click(screen.getByTestId("domain-experts-editor-save"));
    await waitFor(() => {
      expect(updateDomain).toHaveBeenCalledTimes(1);
    });
    expect(
      (await screen.findByTestId("domain-experts-editor-status")).textContent,
    ).toContain("Changes saved.");
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
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    fireEvent.click(await screen.findByTestId("domain-experts-editor-save"));
    expect(
      (await screen.findByTestId("domain-experts-editor-status")).textContent,
    ).toContain("DOMAIN_INVALID: id is reserved");
  });
});
