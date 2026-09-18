import { describe, expect, it } from "vitest";
import { domainOf } from "./helpers/fakes.js";
import { PAYMENTS, fixtureOf, resolve } from "./scope-resolution.helpers.js";

describe("scope resolution: delegation", () => {
  it("lists the other enabled domains as peers", async () => {
    const fixture = fixtureOf([
      PAYMENTS,
      domainOf("inventory", { name: "Inventory" }),
      domainOf("platform", { name: "Platform", enabled: false }),
    ]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.delegation.peers.map((peer) => peer.domainId)).toEqual([
      "inventory",
    ]);
    expect(profile.delegation.mode).toBe("expert-only");
  });

  it("restricts peers to the configured target list", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, targets: ["inventory"] },
    });
    const fixture = fixtureOf([
      definition,
      domainOf("inventory"),
      domainOf("platform"),
    ]);
    const profile = await resolve(fixture, definition);
    expect(profile.delegation.peers.map((peer) => peer.domainId)).toEqual([
      "inventory",
    ]);
  });

  it("degrades a target that is missing or disabled", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, targets: ["inventory"] },
    });
    const fixture = fixtureOf([definition]);
    const profile = await resolve(fixture, definition);
    expect(profile.degradations.map((item) => item.code)).toContain(
      "DELEGATION_TARGET_MISSING",
    );
  });

  it("reports the mode as disabled when cross-domain access is off", async () => {
    const definition = domainOf("payments", {
      ...PAYMENTS,
      delegation: { ...PAYMENTS.delegation, allowCrossDomain: false },
    });
    const fixture = fixtureOf([definition, domainOf("inventory")]);
    const profile = await resolve(fixture, definition);
    expect(profile.delegation.mode).toBe("disabled");
    expect(profile.delegation.peers[0]?.allowed).toBe(false);
  });

  it("carries the depth budget into the profile", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(profile.depthBudget).toBe(3);
  });
});
