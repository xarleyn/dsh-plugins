// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { PROFILE, ok, renderPage } from "./client-page.helpers.js";

describe("client page: degraded configuration", () => {
  it("lists a missing scope provider with the references that caused it", async () => {
    renderPage({
      resolveScope: () =>
        Promise.resolve(
          ok({
            profile: {
              ...PROFILE,
              degradations: [
                {
                  code: "SCOPE_PROVIDER_MISSING" as const,
                  message:
                    'Domain "payments" configures scope provider "jira", but no provider with that id is registered.',
                  refs: ["jira"],
                },
              ],
              providers: [
                {
                  id: "jira",
                  title: "jira",
                  registered: false,
                  enforcement: "advisory" as const,
                  note: 'No scope provider with id "jira" is registered.',
                },
              ],
            },
          }),
        ),
    });
    fireEvent.click(await screen.findByText("Payments"));
    expect(await screen.findByText(/Degraded configuration/u)).toBeTruthy();
    expect(screen.getByText("SCOPE_PROVIDER_MISSING")).toBeTruthy();
    expect(
      screen.getByText(/no provider with that id is registered/u),
    ).toBeTruthy();
    expect(screen.getByText("no")).toBeTruthy();
  });

  it("surfaces a refused scope resolution instead of rendering an empty inspector", async () => {
    renderPage({
      resolveScope: () =>
        Promise.resolve({
          ok: false,
          code: "DOMAIN_DISABLED",
          message: "domain is disabled",
        }),
    });
    fireEvent.click(await screen.findByText("Payments"));
    expect(
      await screen.findByText(/DOMAIN_DISABLED: domain is disabled/u),
    ).toBeTruthy();
  });
});
