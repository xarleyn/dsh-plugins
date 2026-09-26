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
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    expect(
      (await screen.findByTestId("domain-experts-inspector-degraded-title"))
        .textContent,
    ).toContain("Degraded configuration");
    const degradation = screen.getByTestId(
      "domain-experts-inspector-degradation",
    );
    expect(
      screen.getByTestId("domain-experts-inspector-degradation-code")
        .textContent,
    ).toBe("SCOPE_PROVIDER_MISSING");
    expect(degradation.textContent).toContain(
      "no provider with that id is registered",
    );
    expect(
      screen.getByTestId("domain-experts-inspector-provider-registered")
        .textContent,
    ).toBe("no");
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
    fireEvent.click(await screen.findByTestId("domain-experts-page-open"));
    expect(
      (await screen.findByTestId("domain-experts-editor-profile-error"))
        .textContent,
    ).toContain("DOMAIN_DISABLED: domain is disabled");
  });
});
