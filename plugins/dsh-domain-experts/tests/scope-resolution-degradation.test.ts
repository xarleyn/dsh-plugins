import { describe, expect, it } from "vitest";
import { domainOf } from "./helpers/fakes.js";
import { PAYMENTS, fixtureOf, resolve } from "./scope-resolution.helpers.js";

describe("scope resolution: degradation", () => {
  it("reports an unregistered scope provider and keeps its config inert", async () => {
    const definition = domainOf("payments", {
      scope: {
        ...PAYMENTS.scope,
        providers: { jira: '{"projects":["PAY"]}' },
      },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.degradations.map((item) => item.code)).toContain(
      "SCOPE_PROVIDER_MISSING",
    );
    const jira = profile.providers.find((provider) => provider.id === "jira");
    expect(jira).toMatchObject({ registered: false, enforcement: "advisory" });
  });

  it("calls a registered provider and carries its external scope", async () => {
    const definition = domainOf("payments", {
      scope: { ...PAYMENTS.scope, providers: { wiki: '{"spaces":["PAY"]}' } },
    });
    const fixture = fixtureOf([definition]);
    fixture.scopeProviders.register({
      id: "wiki",
      title: "Wiki",
      enforcement: "advisory",
      builtin: false,
      validate: () => undefined,
      describe: () => "1 space",
      apply: () =>
        Promise.resolve({ resources: [], external: '{"spaces":["PAY"]}' }),
    });
    const profile = await resolve(fixture, definition);
    expect(profile.scope.external["wiki"]).toBe('{"spaces":["PAY"]}');
    expect(
      profile.providers.find((provider) => provider.id === "wiki")?.registered,
    ).toBe(true);
  });

  it("degrades a provider that refuses its own configuration", async () => {
    const definition = domainOf("payments", {
      scope: { ...PAYMENTS.scope, providers: { wiki: "not json" } },
    });
    const fixture = fixtureOf([definition]);
    fixture.scopeProviders.register({
      id: "wiki",
      title: "Wiki",
      enforcement: "advisory",
      builtin: false,
      validate: () => {
        throw new Error("expected a JSON document");
      },
      describe: () => "",
      apply: () => Promise.resolve({ resources: [], external: "" }),
    });
    const profile = await resolve(fixture, definition);
    const degradation = profile.degradations.find(
      (item) => item.code === "SCOPE_PROVIDER_MISSING",
    );
    expect(degradation?.message).toContain("expected a JSON document");
  });
});
