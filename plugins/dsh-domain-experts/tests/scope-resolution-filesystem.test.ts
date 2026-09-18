import { describe, expect, it } from "vitest";
import { domainOf } from "./helpers/fakes.js";
import {
  CODE_WORKER,
  PAYMENTS,
  fixtureOf,
  resolve,
} from "./scope-resolution.helpers.js";

describe("scope resolution: filesystem resources", () => {
  it("lists the three resource classes", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.resources.map((resource) => [resource.class, resource.path]),
    ).toEqual([
      ["primary", "services/payments/**"],
      ["shared", "packages/common/**"],
      ["denied", "services/inventory/**"],
    ]);
  });

  it("reports advisory enforcement while no worker applies the scope", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.resources.every(
        (resource) => resource.enforcement === "advisory",
      ),
    ).toBe(true);
    expect(profile.providers[0]).toMatchObject({
      id: "filesystem",
      registered: true,
    });
  });

  it("reports enforced as soon as a selected worker claims it", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    fixture.workers.register(CODE_WORKER);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.resources.every(
        (resource) => resource.enforcement === "enforced",
      ),
    ).toBe(true);
    expect(profile.resources[0]?.enforcedBy).toEqual(["code_worker"]);
  });

  it("stays advisory when the enforcing worker is denied", async () => {
    const fixture = fixtureOf([
      domainOf("payments", {
        ...PAYMENTS,
        tools: { allow: ["code_worker"], deny: ["code_worker"] },
      }),
    ]);
    fixture.workers.register(CODE_WORKER);
    const profile = await resolve(fixture, fixture.domains.require("payments"));
    expect(
      profile.resources.every(
        (resource) => resource.enforcement === "advisory",
      ),
    ).toBe(true);
  });

  it("carries the knowledge scope into the resolved scope", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.scope.knowledge).toEqual({
      include: ["docs/payments/**"],
      exclude: ["docs/legacy/**"],
    });
  });
});
