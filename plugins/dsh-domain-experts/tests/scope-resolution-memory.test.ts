import { describe, expect, it } from "vitest";
import { resolveExpert } from "../src/host/resolver.js";
import type { DomainDefinition } from "../src/types.js";
import { domainOf } from "./helpers/fakes.js";
import { PAYMENTS, fixtureOf, resolve } from "./scope-resolution.helpers.js";

describe("scope resolution: memory namespaces", () => {
  it("grants read/write on the private namespace and read-only on shared ones", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolve(fixture, PAYMENTS);
    expect(
      profile.memory.map((entry) => [entry.namespace, entry.access]),
    ).toEqual([
      ["domain/payments", "read-write"],
      ["shared/product", "read-only"],
    ]);
    expect(profile.scope.memory).toEqual({
      namespace: "domain/payments",
      sharedNamespaces: ["shared/product"],
    });
  });

  it("adds explicitly configured foreign namespaces in direct-read mode only", async () => {
    const base = domainOf("payments", {
      ...PAYMENTS,
      delegation: {
        ...PAYMENTS.delegation,
        crossDomainMode: "direct-read",
        directRead: ["domain/inventory"],
      },
    });
    const fixture = fixtureOf([base]);
    const profile = await resolve(fixture, base);
    expect(profile.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
      "shared/product",
      "domain/inventory",
    ]);

    const expertOnly = {
      ...base,
      delegation: { ...base.delegation, crossDomainMode: "expert-only" },
    };
    const second = await resolve(fixture, expertOnly as DomainDefinition);
    expect(second.memory.map((entry) => entry.namespace)).toEqual([
      "domain/payments",
      "shared/product",
    ]);
  });

  it("degrades when the configured memory provider is absent", async () => {
    const fixture = fixtureOf([PAYMENTS]);
    const profile = await resolveExpert(
      { ...fixture.dependencies, memoryProviderId: "openviking" },
      { definition: PAYMENTS, workspaceDir: "", callerDomain: null, depth: 1 },
    );
    expect(profile.degradations.map((item) => item.code)).toContain(
      "MEMORY_PROVIDER_MISSING",
    );
  });
});
